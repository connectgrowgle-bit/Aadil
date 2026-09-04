import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

export const ATTRIBUTION_COOKIE_NAME = "ge_ref";
export const ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30-day attribution window

export function generateClickToken(): string {
  return randomBytes(24).toString("base64url");
}

function sign(clickToken: string): string {
  const env = getEnv();
  return createHmac("sha256", env.sessionSecret).update(clickToken).digest("hex");
}

/** The signed cookie value set on a valid `?ref=` click — Rule/spec §8:
 * "sets a signed cookie" so a tampered value is detectable without a DB
 * round trip, even though the click token itself is still looked up in
 * affiliate_clicks to resolve the actual affiliate. */
export function signClickToken(clickToken: string): string {
  return `${clickToken}.${sign(clickToken)}`;
}

export function verifyClickCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const clickToken = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  const expected = sign(clickToken);

  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(signature, "hex");
  } catch {
    return null;
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return clickToken;
}
