import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeSession } from "@/lib/auth/session";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const actor = await resolveActor(token);
  if (actor) {
    await revokeSession(actor.sessionId);
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.redirect(new URL("/", request.url));
}
