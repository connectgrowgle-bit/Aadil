"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { registerClient } from "@/lib/auth/register";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/cookies";

export interface RegisterActionState {
  error?: string;
}

const MIN_PASSWORD_LENGTH = 10;

export async function registerAction(
  _prevState: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!email || !fullName) {
    return { error: "Please fill in every field." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const headerList = await headers();
  const result = await registerClient({
    email,
    password,
    fullName,
    ipAddress: headerList.get("x-real-ip") ?? undefined,
    userAgent: headerList.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    if (result.error === "EMAIL_TAKEN") {
      return { error: "An account with this email already exists." };
    }
    return { error: "Registration is temporarily unavailable. Please try again shortly." };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.session.token, sessionCookieOptions(result.session.expiresAt));

  redirect("/account");
}
