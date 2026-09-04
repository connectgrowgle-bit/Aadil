import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orders, payments } from "@/lib/db/schema";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { getPaymentGateway } from "@/lib/payments";
import { formatPaiseAsInr } from "@/lib/money";
import { simulatePaymentAction } from "./actions";

// An order belonging to someone else 404s, not 403s — Rule 14.
export default async function CheckoutPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) redirect("/login");

  const db = getDb();
  const [order] = await db
    .select({ id: orders.id, userId: orders.userId, stage: orders.stage, amountPaise: orders.amountPaise })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order || order.userId !== actor.userId) notFound();

  const [payment] = await db
    .select({ status: payments.status, providerOrderId: payments.providerOrderId })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .limit(1);

  const gateway = getPaymentGateway();

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Checkout</h1>
      <dl className="mt-6 space-y-2 rounded-lg border border-gray-200 p-5 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Order</dt>
          <dd className="font-mono text-gray-900">{order.id}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Amount</dt>
          <dd className="text-gray-900">{formatPaiseAsInr(order.amountPaise)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Order stage</dt>
          <dd className="text-gray-900">{order.stage}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Payment status</dt>
          <dd className="text-gray-900">{payment?.status ?? "unknown"}</dd>
        </div>
      </dl>

      {gateway.name === "mock" && order.stage === "CREATED" && (
        <form action={simulatePaymentAction} className="mt-6 flex gap-3">
          <input type="hidden" name="orderId" value={order.id} />
          <button
            type="submit"
            name="outcome"
            value="captured"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Simulate successful payment
          </button>
          <button
            type="submit"
            name="outcome"
            value="failed"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Simulate failed payment
          </button>
        </form>
      )}
      {gateway.name === "razorpay" && (
        <p className="mt-6 text-sm text-gray-500">
          Razorpay Standard Checkout embedding is not built yet — see STATUS.md.
        </p>
      )}
      {order.stage !== "CREATED" && (
        <p className="mt-6 text-sm text-gray-600">
          This order has moved past the payment step. See{" "}
          <Link href="/account" className="underline">
            your account
          </Link>
          .
        </p>
      )}
    </div>
  );
}
