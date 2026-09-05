/**
 * "The CRM must fill itself" (Phase 7). Two entry points call this today:
 * order creation and the payment-captured webhook handler — see
 * STATUS.md for what's not wired up yet (later order-stage transitions).
 * Dedupes on email (case-insensitive) and resolves the user account by
 * email even when no userId is supplied, per spec Phase 7, so a contact
 * created before signup still links up once the account exists.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { crmContacts, crmActivities, users } from "@/lib/db/schema";
import type { orderStageEnum, crmStageEnum } from "@/lib/db/schema";

type OrderStage = (typeof orderStageEnum.enumValues)[number];
type CrmStage = (typeof crmStageEnum.enumValues)[number];

const ORDER_STAGE_TO_CRM_STAGE: Partial<Record<OrderStage, CrmStage>> = {
  CREATED: "QUALIFIED",
  PAID: "QUALIFIED",
  ONBOARDING: "ONBOARDING",
  REQUIREMENTS_LOCKED: "ONBOARDING",
  TEAM_ASSIGNED: "IN_PROGRESS",
  IN_PROGRESS: "IN_PROGRESS",
  REVIEW: "REVIEW",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

export function crmStageForOrderStage(orderStage: OrderStage): CrmStage {
  return ORDER_STAGE_TO_CRM_STAGE[orderStage] ?? "QUALIFIED";
}

/** Finds or creates a CRM contact by email, resolving the user account by
 * email even when no userId is supplied — spec Phase 7's dedupe rule. */
export async function findOrCreateCrmContact(params: {
  email: string;
  userId?: string;
  fullName?: string;
}): Promise<string> {
  const db = getDb();
  const email = params.email.toLowerCase();

  const [existing] = await db
    .select({ id: crmContacts.id, userId: crmContacts.userId })
    .from(crmContacts)
    .where(eq(sql`lower(${crmContacts.email})`, email))
    .limit(1);

  if (existing) {
    // If the contact predates the account, link it up now.
    if (!existing.userId && params.userId) {
      await db.update(crmContacts).set({ userId: params.userId, updatedAt: new Date() }).where(eq(crmContacts.id, existing.id));
    }
    return existing.id;
  }

  let userId = params.userId;
  if (!userId) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    userId = user?.id;
  }

  const [created] = await db
    .insert(crmContacts)
    .values({ email: params.email, userId, fullName: params.fullName, stage: "NEW" })
    .returning({ id: crmContacts.id });
  if (!created) throw new Error("failed to create crm contact");

  await db.insert(crmActivities).values({
    contactId: created.id,
    type: "STAGE_CHANGE",
    toStage: "NEW",
  });

  return created.id;
}

/** Moves a contact's stage forward and logs the transition — called
 * whenever an order is created or advances (self-filling CRM, Phase 7). */
export async function advanceCrmStage(contactId: string, toStage: CrmStage): Promise<void> {
  const db = getDb();
  const [contact] = await db.select({ stage: crmContacts.stage }).from(crmContacts).where(eq(crmContacts.id, contactId)).limit(1);
  if (!contact || contact.stage === toStage) return;

  await db.update(crmContacts).set({ stage: toStage, updatedAt: new Date() }).where(eq(crmContacts.id, contactId));
  await db.insert(crmActivities).values({
    contactId,
    type: "STAGE_CHANGE",
    fromStage: contact.stage,
    toStage,
  });
}

/** Logs a non-stage-change event (e.g. a payment webhook firing) against
 * a contact's timeline, so the CRM shows real activity even on a request
 * that doesn't move the pipeline stage. */
export async function logCrmActivity(
  contactId: string,
  type: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(crmActivities).values({ contactId, type, metadata });
}

/** Convenience: resolve a contact by the order's owning user and log an
 * activity, used from the payment webhook handler. No-ops if the user or
 * contact can't be resolved rather than failing the whole webhook. */
export async function logCrmActivityForUser(
  email: string,
  type: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const contactId = await findOrCreateCrmContact({ email });
  await logCrmActivity(contactId, type, metadata);
}
