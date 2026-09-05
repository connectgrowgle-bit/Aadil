"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orders, payments } from "@/lib/db/schema";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { getPaymentGateway } from "@/lib/payments";
import { MockPaymentGateway } from "@/lib/payments/mock-gateway";
import { getEnv } from "@/lib/env";

/**
 * Simulates a real payment-provider webhook delivery for this order and
 * POSTs it to the actual /api/webhooks/payments endpoint over HTTP — this
 * exercises the exact same signature-verification and idempotency path a
 * real Razorpay delivery would hit, rather than calling internal
 * functions directly as a shortcut. Only usable when PAYMENT_PROVIDER=mock.
 */
export async function simulatePaymentAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  const outcome = String(formData.get("outcome") ?? "captured");

  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) redirect("/login");

  const db = getDb();
  const [order] = await db.select({ id: orders.id, userId: orders.userId }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.userId !== actor.userId) {
    redirect("/account");
  }

  const [payment] = await db
    .select({ id: payments.id, providerOrderId: payments.providerOrderId, amountPaise: payments.amountPaise })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1);
  if (!payment?.providerOrderId) redirect("/account");

  const gateway = getPaymentGateway();
  if (!(gateway instanceof MockPaymentGateway)) {
    // Never let this action pretend to simulate a real gateway.
    throw new Error("Payment simulation is only available with PAYMENT_PROVIDER=mock");
  }

  const { rawBody, signature } = gateway.buildSignedWebhookDelivery({
    event: outcome === "failed" ? "payment.failed" : "payment.captured",
    providerPaymentId: `mock_pay_${payment.id}`,
    providerOrderId: payment.providerOrderId,
    amountPaise: payment.amountPaise,
    status: outcome === "failed" ? "failed" : "captured",
  });

  const env = getEnv();
  await fetch(new URL("/api/webhooks/payments", env.appUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": signature },
    body: rawBody,
  });

  redirect(`/checkout/${orderId}`);
}
