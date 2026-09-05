import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { rejectPayout } from "@/lib/payouts/engine";

export async function POST(request: Request, { params }: { params: Promise<{ payoutId: string }> }) {
  const { payoutId } = await params;
  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await actor.can("payout.approve"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "rejected";

  await rejectPayout(payoutId, reason);
  return NextResponse.json({ status: "ok" });
}
