import { NextResponse, type NextRequest } from "next/server";

/**
 * Named `proxy` (Next.js 16 renamed the `middleware` file convention —
 * same runtime, same API). Not the security boundary (Rule 11) and does
 * nothing authorization-related here — it only detects `?ref=` and hands
 * off to a Node route handler that has database access (this runs on the
 * edge runtime, which cannot touch Postgres). It never signs a cookie
 * itself; the click route does that. Deleting this file only means
 * referral links stop being recorded — it exposes nothing (docs/
 * ARCHITECTURE.md §8).
 */
export function proxy(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");
  if (!ref) return NextResponse.next();

  const dest = new URL(request.nextUrl.pathname, request.nextUrl.origin);
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key !== "ref") dest.searchParams.append(key, value);
  }

  const clickUrl = new URL("/api/attribution/click", request.nextUrl.origin);
  clickUrl.searchParams.set("ref", ref);
  clickUrl.searchParams.set("dest", dest.pathname + dest.search);

  return NextResponse.redirect(clickUrl);
}

export const config = {
  // Skip the click hand-off for anything that isn't a page request — an
  // asset or API call carrying a stray ?ref= should never be attributed.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
