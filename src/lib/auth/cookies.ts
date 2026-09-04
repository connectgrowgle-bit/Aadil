import { getEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "ge_session";

/**
 * Secure must be keyed off whether the app is actually served over https
 * (APP_URL), never off NODE_ENV — `npm start` runs production mode over
 * plain http on localhost, and a NODE_ENV-keyed Secure flag makes browsers
 * silently drop the cookie there (docs/MISTAKES.md item 3).
 */
export function sessionCookieOptions(expiresAt: Date) {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
