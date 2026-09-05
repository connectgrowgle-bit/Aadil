import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { affiliates } from "@/lib/db/schema";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import {
  requestPayout,
  NothingAvailableError,
  BelowMinimumError,
  OpenPayoutExistsError,
} from "@/lib/payouts/engine";

/** Self-service: an affiliate requests a payout of their own available
 * balance. Never accepts an affiliateId from the request body — it's
 * always resolved from the authenticated actor's own affiliate record,
 * so nobody can request a payout for someone else's account. */
export async function POST() {
  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await actor.can("payout.request"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = getDb();
  const [affiliate] = await db.select({ id: affiliates.id }).from(affiliates).where(eq(affiliates.userId, actor.userId)).limit(1);
  if (!affiliate) return NextResponse.json({ error: "no affiliate account" }, { status: 404 });

  try {
    const result = await requestPayout(affiliate.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NothingAvailableError || err instanceof BelowMinimumError || err instanceof OpenPayoutExistsError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
