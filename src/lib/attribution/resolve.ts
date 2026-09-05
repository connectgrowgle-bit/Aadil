import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { affiliateClicks, affiliateLinks, affiliates } from "@/lib/db/schema";
import { verifyClickCookie } from "./cookie";

export interface ResolvedAttribution {
  affiliateId: string;
  affiliateClickId: string;
  affiliateUserId: string;
}

/** Verifies the signed cookie, then resolves it to a still-active
 * affiliate. Returns null for a missing/tampered cookie, an unknown
 * click token, or an affiliate that is no longer ACTIVE — attribution is
 * re-checked at order-creation time, not trusted from click time alone. */
export async function resolveAttributionFromCookie(
  cookieValue: string | undefined,
): Promise<ResolvedAttribution | null> {
  const clickToken = verifyClickCookie(cookieValue);
  if (!clickToken) return null;

  const db = getDb();
  const [row] = await db
    .select({
      affiliateClickId: affiliateClicks.id,
      affiliateId: affiliateLinks.affiliateId,
      affiliateStatus: affiliates.status,
      affiliateUserId: affiliates.userId,
    })
    .from(affiliateClicks)
    .innerJoin(affiliateLinks, eq(affiliateLinks.id, affiliateClicks.affiliateLinkId))
    .innerJoin(affiliates, eq(affiliates.id, affiliateLinks.affiliateId))
    .where(eq(affiliateClicks.clickToken, clickToken))
    .limit(1);

  if (!row || row.affiliateStatus !== "ACTIVE") return null;

  return {
    affiliateId: row.affiliateId,
    affiliateClickId: row.affiliateClickId,
    affiliateUserId: row.affiliateUserId,
  };
}
