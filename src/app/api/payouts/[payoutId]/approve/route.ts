import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { approvePayout } from "@/lib/payouts/engine";

export async function POST(_request: Request, { params }: { params: Promise<{ payoutId: string }> }) {
  const { payoutId } = await params;
  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await actor.can("payout.approve"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await approvePayout(payoutId, actor.userId);
  return NextResponse.json({ status: "ok" });
}
