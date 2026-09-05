import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { markPayoutPaid } from "@/lib/payouts/engine";

/**
 * Stands in for the RazorpayX/Cashfree disbursement webhook this build
 * doesn't have (see docs/ARCHITECTURE.md §7) — a real deployment would
 * call markPayoutPaid from that webhook, not from an admin-triggered
 * route. Gated behind payout.approve until that integration exists.
 */
export async function POST(request: Request, { params }: { params: Promise<{ payoutId: string }> }) {
  const { payoutId } = await params;
  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await actor.can("payout.approve"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const providerReference = typeof body.providerReference === "string" ? body.providerReference : `manual-${Date.now()}`;

  await markPayoutPaid(payoutId, providerReference);
  return NextResponse.json({ status: "ok" });
}
