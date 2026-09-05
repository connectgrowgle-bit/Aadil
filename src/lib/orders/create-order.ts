/**
 * Order creation (Phase 6 seed). Price is read server-side from
 * service_plans and snapshotted onto the order — the client only ever
 * says which plan (Rule 4/5). Wires together the three self-filling
 * mechanisms this build has real code for: attribution (a PENDING
 * conversion if a valid ref cookie is present), CRM (a contact is
 * created/found and moved to QUALIFIED), and the payment gateway (a
 * provider order is created up front, so a payment without one is never
 * possible — spec Phase 5).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { servicePlans, orders, payments, users } from "@/lib/db/schema";
import { getPaymentGateway } from "@/lib/payments";
import { createPendingConversion } from "@/lib/commission/engine";
import { findOrCreateCrmContact, advanceCrmStage, crmStageForOrderStage } from "@/lib/crm/sync";
import type { ResolvedAttribution } from "@/lib/attribution/resolve";

export interface CreateOrderResult {
  orderId: string;
  paymentId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
}

export class InactivePlanError extends Error {
  constructor() {
    super("This plan is not currently available.");
    this.name = "InactivePlanError";
  }
}

export async function createOrder(params: {
  userId: string;
  servicePlanId: string;
  attribution?: ResolvedAttribution | null;
}): Promise<CreateOrderResult> {
  const db = getDb();

  const [plan] = await db
    .select({ id: servicePlans.id, pricePaise: servicePlans.pricePaise, isActive: servicePlans.isActive })
    .from(servicePlans)
    .where(eq(servicePlans.id, params.servicePlanId))
    .limit(1);
  if (!plan || !plan.isActive) {
    throw new InactivePlanError();
  }

  const [order] = await db
    .insert(orders)
    .values({ userId: params.userId, servicePlanId: plan.id, amountPaise: plan.pricePaise })
    .returning({ id: orders.id });
  if (!order) throw new Error("failed to create order");

  const [payment] = await db
    .insert(payments)
    .values({
      purpose: "SERVICE_ORDER",
      payerUserId: params.userId,
      orderId: order.id,
      amountPaise: plan.pricePaise,
    })
    .returning({ id: payments.id });
  if (!payment) throw new Error("failed to create payment");

  const gateway = getPaymentGateway();
  const { providerOrderId } = await gateway.createOrder({
    amountPaise: plan.pricePaise,
    currency: "INR",
    receipt: payment.id,
  });
  await db.update(payments).set({ providerOrderId }).where(eq(payments.id, payment.id));

  // Attribution: never attribute an affiliate's own purchase to
  // themselves.
  if (params.attribution && params.attribution.affiliateUserId !== params.userId) {
    await createPendingConversion({
      affiliateId: params.attribution.affiliateId,
      affiliateClickId: params.attribution.affiliateClickId,
      orderId: order.id,
      orderAmountPaise: plan.pricePaise,
    });
  }

  // CRM self-fill: buying a service moves the contact (Phase 7).
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, params.userId)).limit(1);
  if (user) {
    const contactId = await findOrCreateCrmContact({ email: user.email, userId: params.userId });
    await advanceCrmStage(contactId, crmStageForOrderStage("CREATED"));
  }

  return {
    orderId: order.id,
    paymentId: payment.id,
    providerOrderId,
    amountPaise: plan.pricePaise,
    currency: "INR",
  };
}
