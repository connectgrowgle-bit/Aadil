import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { affiliateLinks, affiliateClicks, affiliates } from "@/lib/db/schema";
import { generateClickToken, signClickToken, ATTRIBUTION_COOKIE_NAME, ATTRIBUTION_COOKIE_MAX_AGE_SECONDS } from "@/lib/attribution/cookie";
import { getEnv } from "@/lib/env";

/**
 * The Node-runtime half of the attribution handoff (docs/ARCHITECTURE.md
 * §8): records the click, sets the signed cookie, then redirects to the
 * ref-stripped URL — a refresh is not a second click, and a URL shared
 * onward (now without ?ref=) does not re-attribute to whoever shares it.
 * An invalid or inactive ref never breaks the page: it just redirects
 * without recording anything.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref");
  const rawDest = url.searchParams.get("dest") ?? "/";

  // Only ever redirect to a same-origin relative path — never let `dest`
  // become an open redirect.
  const dest = rawDest.startsWith("/") && !rawDest.startsWith("//") ? rawDest : "/";
  const destUrl = new URL(dest, url.origin);

  if (!ref) {
    return NextResponse.redirect(destUrl);
  }

  const db = getDb();
  const [link] = await db
    .select({ id: affiliateLinks.id, affiliateId: affiliateLinks.affiliateId })
    .from(affiliateLinks)
    .where(eq(affiliateLinks.refCode, ref))
    .limit(1);

  if (!link) {
    return NextResponse.redirect(destUrl);
  }

  const [affiliate] = await db
    .select({ status: affiliates.status })
    .from(affiliates)
    .where(and(eq(affiliates.id, link.affiliateId), eq(affiliates.status, "ACTIVE")))
    .limit(1);

  if (!affiliate) {
    // A real link, but not (or no longer) an active affiliate — record
    // nothing and attribute nothing.
    return NextResponse.redirect(destUrl);
  }

  const clickToken = generateClickToken();
  await db.insert(affiliateClicks).values({
    affiliateLinkId: link.id,
    clickToken,
    landingUrl: dest,
    ipAddress: request.headers.get(getEnv().trustedProxyHeader) ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  const response = NextResponse.redirect(destUrl);
  response.cookies.set(ATTRIBUTION_COOKIE_NAME, signClickToken(clickToken), {
    httpOnly: true,
    secure: getEnv().appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
