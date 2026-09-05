/**
 * Authenticated cron endpoint for the Phase 12 scheduler. Constant-time
 * secret comparison — a naive `===` leaks timing information about how
 * many leading characters matched, letting an attacker recover the
 * secret byte by byte. Without CRON_SECRET configured, this returns 503
 * rather than running openly; env validation already requires it to be
 * set everywhere, so 503 here means something is badly wrong with boot,
 * not a normal state to expect in production.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { releaseMaturedCommissions } from "@/lib/commission/scheduler";

function isAuthorized(request: Request, cronSecret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;

  const expected = Buffer.from(cronSecret);
  const actual = Buffer.from(provided);
  // Buffers of different length must still run a comparison of matching
  // cost — pad rather than short-circuit on length before the compare.
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, expected); // burn equivalent time, discard result
    return false;
  }
  return timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  const env = getEnv();
  if (!env.cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!isAuthorized(request, env.cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await releaseMaturedCommissions();
  return NextResponse.json(summary);
}
