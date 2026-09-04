import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { orders, orderEvents, users } from "@/lib/db/schema";
import type { orderStageEnum } from "@/lib/db/schema";
import { findOrCreateCrmContact, advanceCrmStage, crmStageForOrderStage } from "@/lib/crm/sync";

type OrderStage = (typeof orderStageEnum.enumValues)[number];

/** Advances an order's stage, logs the transition in order_events, and
 * syncs the CRM contact's stage to match — the mechanism "the CRM fills
 * itself" (Phase 7) actually runs through. Idempotent: calling this again
 * with the order already at `toStage` (a webhook replay after the
 * webhook_events-level dedup already would have blocked it — this is
 * defense in depth) is a no-op. */
export async function advanceOrderStage(orderId: string, toStage: OrderStage): Promise<void> {
  const db = getDb();
  const [order] = await db
    .select({ stage: orders.stage, userId: orders.userId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) throw new Error(`order ${orderId} not found`);
  if (order.stage === toStage) return;

  await db.update(orders).set({ stage: toStage, updatedAt: new Date() }).where(eq(orders.id, orderId));
  await db.insert(orderEvents).values({ orderId, fromStage: order.stage, toStage });

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, order.userId)).limit(1);
  if (user) {
    const contactId = await findOrCreateCrmContact({ email: user.email, userId: order.userId });
    await advanceCrmStage(contactId, crmStageForOrderStage(toStage));
  }
}
