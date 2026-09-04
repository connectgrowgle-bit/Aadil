"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { attemptLogin } from "@/lib/auth/login";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/cookies";

export interface LoginActionState {
  error?: string;
}

// The message is identical whether the email doesn't exist or the
// password is wrong (Rule 14) — attemptLogin() already made the two cases
// take the same code path and roughly the same time; this is the other
// half, keeping the response text identical too.
const GENERIC_ERROR = "Invalid email or password.";

export async function loginAction(_prevState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: GENERIC_ERROR };
  }

  const headerList = await headers();
  const result = await attemptLogin({
    email,
    password,
    ipAddress: headerList.get("x-real-ip") ?? undefined,
    userAgent: headerList.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    return { error: GENERIC_ERROR };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.session.token, sessionCookieOptions(result.session.expiresAt));

  redirect("/account");
}
