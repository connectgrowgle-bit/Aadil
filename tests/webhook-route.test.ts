/**
 * Calls the real exported POST handler from the webhook route with a real
 * Request object — the same function Next.js would invoke for an actual
 * HTTP delivery, not a re-implementation of its logic.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { payments, orders, commissionEntries, crmActivities, crmContacts, webhookEvents } from "@/lib/db/schema";
import { POST } from "@/app/api/webhooks/payments/route";
import { MockPaymentGateway } from "@/lib/payments/mock-gateway";
import { createPendingConversion } from "@/lib/commission/engine";
import { seedCommissionPolicy } from "@/lib/db/seed/catalogue.logic";
import {
  createTestUser,
  createTestServiceWithPlan,
  createTestOrder,
  createTestPayment,
  createTestAffiliate,
} from "./helpers/fixtures";

beforeAll(async () => {
  await seedCommissionPolicy();
});

const WEBHOOK_URL = "http://localhost/api/webhooks/payments";
const gateway = new MockPaymentGateway();

function postWebhook(rawBody: string, signature: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("x-mock-signature", signature);
  return POST(new Request(WEBHOOK_URL, { method: "POST", headers, body: rawBody }));
}

async function setupOrderAndPayment(amountPaise = 500_00) {
  const buyer = await createTestUser();
  const { planId } = await createTestServiceWithPlan(amountPaise);
  const orderId = await createTestOrder(buyer.id, planId, amountPaise);
  const payment = await createTestPayment({ orderId, payerUserId: buyer.id, amountPaise });
  return { buyer, orderId, paymentId: payment.id, providerOrderId: payment.providerOrderId, amountPaise };
}

describe("webhook route: signature verification", () => {
  it("rejects a bad signature with 400 and writes nothing", async () => {
    const { providerOrderId, amountPaise } = await setupOrderAndPayment();
    const { rawBody } = gateway.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: "pay_bad_sig",
      providerOrderId,
      amountPaise,
      status: "captured",
    });
    const res = await postWebhook(rawBody, "0".repeat(64));
    expect(res.status).toBe(400);
  });

  it("rejects a missing signature with 400", async () => {
    const { providerOrderId, amountPaise } = await setupOrderAndPayment();
    const { rawBody } = gateway.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: "pay_no_sig",
      providerOrderId,
      amountPaise,
      status: "captured",
    });
    const res = await postWebhook(rawBody, null);
    expect(res.status).toBe(400);
  });
});

describe("webhook route: payment.captured", () => {
  it("advances the order to PAID and marks the payment CAPTURED", async () => {
    const { orderId, providerOrderId, amountPaise, paymentId } = await setupOrderAndPayment();
    const { rawBody, signature } = gateway.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: `pay_${paymentId}`,
      providerOrderId,
      amountPaise,
      status: "captured",
    });

    const res = await postWebhook(rawBody, signature);
    expect(res.status).toBe(200);

    const db = getDb();
    const [order] = await db.select({ stage: orders.stage }).from(orders).where(eq(orders.id, orderId)).limit(1);
    expect(order?.stage).toBe("PAID");
    const [payment] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId)).limit(1);
    expect(payment?.status).toBe("CAPTURED");
  });

  it("writes an EARNING commission entry when the order was attributed", async () => {
    const buyer = await createTestUser();
    const affiliateOwner = await createTestUser();
    const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
    const amountPaise = 1_000_00;
    const { planId } = await createTestServiceWithPlan(amountPaise);
    const orderId = await createTestOrder(buyer.id, planId, amountPaise);
    await createPendingConversion({ affiliateId: affiliate.id, orderId, orderAmountPaise: amountPaise });
    const payment = await createTestPayment({ orderId, payerUserId: buyer.id, amountPaise });

    const { rawBody, signature } = gateway.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: `pay_${payment.id}`,
      providerOrderId: payment.providerOrderId,
      amountPaise,
      status: "captured",
    });
    await postWebhook(rawBody, signature);

    const db = getDb();
    const entries = await db.select().from(commissionEntries).where(eq(commissionEntries.affiliateId, affiliate.id));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("EARNING");
    expect(entries[0]!.paise).toBeGreaterThan(0);
  });

  it("logs a CRM activity against the buyer's contact", async () => {
    const { providerOrderId, amountPaise, paymentId, buyer } = await setupOrderAndPayment();
    const { rawBody, signature } = gateway.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: `pay_${paymentId}`,
      providerOrderId,
      amountPaise,
      status: "captured",
    });
    await postWebhook(rawBody, signature);

    const db = getDb();
    const [contact] = await db.select({ id: crmContacts.id }).from(crmContacts).where(eq(crmContacts.userId, buyer.id)).limit(1);
    const activities = await db.select().from(crmActivities).where(and(eq(crmActivities.contactId, contact!.id), eq(crmActivities.type, "PAYMENT_CAPTURED")));
    expect(activities.length).toBeGreaterThan(0);
  });

  it("is idempotent: replaying the exact same delivery does not double-write anything", async () => {
    const { orderId, providerOrderId, amountPaise, paymentId } = await setupOrderAndPayment();
    const { rawBody, signature } = gateway.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: `pay_${paymentId}`,
      providerOrderId,
      amountPaise,
      status: "captured",
    });

    const first = await postWebhook(rawBody, signature);
    const second = await postWebhook(rawBody, signature);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).status).toBe("already processed");

    const db = getDb();
    const [order] = await db.select({ stage: orders.stage }).from(orders).where(eq(orders.id, orderId)).limit(1);
    expect(order?.stage).toBe("PAID");

    // Exactly one inbox row for this exact delivery — the whole point of
    // the provider_event_id unique index (Rule 9).
    const events = await db.select().from(webhookEvents).where(eq(webhookEvents.rawBody, rawBody));
    expect(events).toHaveLength(1);
  });
});

describe("webhook route: payment.failed", () => {
  it("cancels the order and writes no commission entry", async () => {
    const buyer = await createTestUser();
    const affiliateOwner = await createTestUser();
    const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
    const amountPaise = 400_00;
    const { planId } = await createTestServiceWithPlan(amountPaise);
    const orderId = await createTestOrder(buyer.id, planId, amountPaise);
    await createPendingConversion({ affiliateId: affiliate.id, orderId, orderAmountPaise: amountPaise });
    const payment = await createTestPayment({ orderId, payerUserId: buyer.id, amountPaise });

    const { rawBody, signature } = gateway.buildSignedWebhookDelivery({
      event: "payment.failed",
      providerPaymentId: `pay_${payment.id}`,
      providerOrderId: payment.providerOrderId,
      amountPaise,
      status: "failed",
    });
    await postWebhook(rawBody, signature);

    const db = getDb();
    const [order] = await db.select({ stage: orders.stage }).from(orders).where(eq(orders.id, orderId)).limit(1);
    expect(order?.stage).toBe("CANCELLED");
    const entries = await db.select().from(commissionEntries).where(eq(commissionEntries.affiliateId, affiliate.id));
    expect(entries).toHaveLength(0);
  });
});

describe("webhook route: refund", () => {
  it("marks the payment PARTIALLY_REFUNDED and reverses a proportional commission share", async () => {
    const buyer = await createTestUser();
    const affiliateOwner = await createTestUser();
    const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
    const amountPaise = 1_000_00;
    const { planId } = await createTestServiceWithPlan(amountPaise);
    const orderId = await createTestOrder(buyer.id, planId, amountPaise);
    await createPendingConversion({ affiliateId: affiliate.id, orderId, orderAmountPaise: amountPaise });
    const payment = await createTestPayment({ orderId, payerUserId: buyer.id, amountPaise });

    // First capture it.
    const captured = gateway.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: `pay_${payment.id}`,
      providerOrderId: payment.providerOrderId,
      amountPaise,
      status: "captured",
    });
    await postWebhook(captured.rawBody, captured.signature);

    // Then a 50% refund.
    const refunded = gateway.buildSignedWebhookDelivery({
      event: "refund.processed",
      providerPaymentId: `pay_${payment.id}`,
      providerOrderId: payment.providerOrderId,
      amountPaise,
      status: "captured",
      amountRefundedPaise: 50_000,
    });
    const res = await postWebhook(refunded.rawBody, refunded.signature);
    expect(res.status).toBe(200);

    const db = getDb();
    const [paymentRow] = await db.select({ status: payments.status, amountRefundedPaise: payments.amountRefundedPaise }).from(payments).where(eq(payments.id, payment.id)).limit(1);
    expect(paymentRow?.status).toBe("PARTIALLY_REFUNDED");
    expect(paymentRow?.amountRefundedPaise).toBe(50_000);

    const reversals = await db.select().from(commissionEntries).where(and(eq(commissionEntries.affiliateId, affiliate.id), eq(commissionEntries.type, "REVERSAL")));
    expect(reversals).toHaveLength(1);
    expect(reversals[0]!.paise).toBeLessThan(0);
  });
});
