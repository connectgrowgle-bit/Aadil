"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { ATTRIBUTION_COOKIE_NAME } from "@/lib/attribution/cookie";
import { resolveAttributionFromCookie } from "@/lib/attribution/resolve";
import { createOrder, InactivePlanError } from "@/lib/orders/create-order";

export async function checkoutAction(formData: FormData): Promise<void> {
  const servicePlanId = String(formData.get("servicePlanId") ?? "");
  const serviceSlug = String(formData.get("serviceSlug") ?? "");

  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) {
    redirect(`/login?next=/${serviceSlug}`);
  }

  const attribution = await resolveAttributionFromCookie(cookieStore.get(ATTRIBUTION_COOKIE_NAME)?.value);

  let orderId: string;
  try {
    const result = await createOrder({ userId: actor.userId, servicePlanId, attribution });
    orderId = result.orderId;
  } catch (err) {
    if (err instanceof InactivePlanError) {
      redirect(`/${serviceSlug}?error=plan_unavailable`);
    }
    throw err;
  }

  redirect(`/checkout/${orderId}`);
}
