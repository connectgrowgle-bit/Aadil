/**
 * Single webhook endpoint for the currently configured payment gateway
 * (Rule 6-9). The raw body is read and signature-verified BEFORE any JSON
 * parsing (Rule 7) — `request.text()`, never `request.json()`, is what
 * makes that possible; parsing first and re-serializing to verify would
 * change the bytes and break the digest.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { webhookEvents, payments, users } from "@/lib/db/schema";
import { getPaymentGateway, WebhookSignatureError, type WebhookEvent } from "@/lib/payments";
import { advanceOrderStage } from "@/lib/orders/stage";
import { confirmConversionAndEarn, cancelConversion, reverseProportionalShare } from "@/lib/commission/engine";
import { logCrmActivityForUser } from "@/lib/crm/sync";

const SIGNATURE_HEADER_BY_PROVIDER: Record<string, string> = {
  razorpay: "x-razorpay-signature",
  mock: "x-mock-signature",
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const gateway = getPaymentGateway();
  const signatureHeader = request.headers.get(SIGNATURE_HEADER_BY_PROVIDER[gateway.name] ?? "x-signature");

  let event: WebhookEvent;
  try {
    event = gateway.verifyAndParseWebhook(rawBody, signatureHeader);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed payload" }, { status: 400 });
  }

  const db = getDb();

  // Idempotency inbox (Rule 9): unique on (provider, provider_event_id).
  // A replay of the exact same delivery finds the row already there and
  // no-ops with 200, never reprocessing.
  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: gateway.name,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      rawBody,
      signatureVerifiedAt: new Date(),
    })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.providerEventId] })
    .returning({ id: webhookEvents.id });

  const webhookEventRow = inserted[0];
  if (!webhookEventRow) {
    return NextResponse.json({ status: "already processed" });
  }

  try {
    await processEvent(event);
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, webhookEventRow.id));
  } catch (err) {
    await db
      .update(webhookEvents)
      .set({ processingError: err instanceof Error ? err.message : String(err) })
      .where(eq(webhookEvents.id, webhookEventRow.id));
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}

async function processEvent(event: WebhookEvent): Promise<void> {
  const db = getDb();
  const [payment] = await db
    .select({ id: payments.id, orderId: payments.orderId, status: payments.status, amountPaise: payments.amountPaise, payerUserId: payments.payerUserId })
    .from(payments)
    .where(eq(payments.providerOrderId, event.providerOrderId))
    .limit(1);

  if (!payment) {
    // A payment without an order_id can't happen from our own checkout
    // flow (create-order.ts always creates the provider order first), but
    // a webhook for a payment we never initiated should not crash — log
    // and move on rather than throw, which would mark the delivery
    // "failed" and invite an infinite provider retry loop.
    return;
  }

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, payment.payerUserId)).limit(1);

  switch (event.eventType) {
    case "payment.captured": {
      await db
        .update(payments)
        .set({ status: "CAPTURED", providerPaymentId: event.providerPaymentId, providerSignatureVerifiedAt: new Date() })
        .where(eq(payments.id, payment.id));

      if (payment.orderId) {
        await advanceOrderStage(payment.orderId, "PAID");
        await confirmConversionAndEarn(payment.orderId);
      }
      if (user) await logCrmActivityForUser(user.email, "PAYMENT_CAPTURED", { paymentId: payment.id });
      break;
    }
    case "payment.failed": {
      await db.update(payments).set({ status: "FAILED" }).where(eq(payments.id, payment.id));
      if (payment.orderId) {
        await advanceOrderStage(payment.orderId, "CANCELLED");
        await cancelConversion(payment.orderId);
      }
      if (user) await logCrmActivityForUser(user.email, "PAYMENT_FAILED", { paymentId: payment.id });
      break;
    }
    case "refund.created":
    case "refund.processed": {
      const cumulativeRefunded = event.amountRefundedPaise ?? 0;
      const newStatus = cumulativeRefunded >= payment.amountPaise ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await db
        .update(payments)
        .set({ status: newStatus, amountRefundedPaise: cumulativeRefunded })
        .where(eq(payments.id, payment.id));

      if (payment.orderId) {
        await reverseProportionalShare(payment.orderId, cumulativeRefunded);
      }
      if (user) {
        await logCrmActivityForUser(user.email, "PAYMENT_REFUNDED", { paymentId: payment.id, cumulativeRefunded });
      }
      break;
    }
  }
}
