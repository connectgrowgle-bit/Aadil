import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { listPermissionsForUser } from "@/lib/auth/can";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

// Demonstrates the one guard every authenticated page must call: this
// page re-resolves the actor from the database on every request. Deleting
// middleware would not change what this page allows — Rule 11.
export default async function AccountPage() {
  const cookieStore = await cookies();
  const actor = await resolveActor(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) {
    redirect("/login");
  }

  const permissions = await listPermissionsForUser(actor.userId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Account</h1>
      <p className="mt-2 text-sm text-gray-500">Session ID: {actor.sessionId}</p>
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Permissions resolved from the database for this request
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {permissions.map((p) => (
          <li key={p} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {p}
          </li>
        ))}
      </ul>
      <form action="/logout" method="post" className="mt-10">
        <button type="submit" className="text-sm font-medium text-gray-600 underline">
          Log out
        </button>
      </form>
    </div>
  );
}
