import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { commissionPolicies } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { formatPaiseAsInr } from "@/lib/money";

export const metadata: Metadata = { title: "Affiliate Programme" };

export default async function AffiliateLandingPage() {
  const db = getDb();
  const [policy] = await db
    .select()
    .from(commissionPolicies)
    .orderBy(desc(commissionPolicies.effectiveFrom))
    .limit(1);

  const commissionPercent = policy ? policy.commissionRateBasisPoints / 100 : 10;
  const registrationFeeEnabled = policy?.registrationFeeEnabled === "true";
  const registrationFeePaise = policy?.registrationFeePaise ?? 200_000;
  const payoutMinimumPaise = policy?.payoutMinimumPaise ?? 100_000;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Affiliate programme</h1>
      <p className="mt-2 text-gray-600">
        Refer GrowEazzy&apos;s services and earn commission. Single-level — you earn only on your
        own referrals, never on people you recruit as affiliates.
      </p>

      <dl className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-5">
          <dt className="text-sm text-gray-500">Commission rate</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{commissionPercent}%</dd>
        </div>
        <div className="rounded-lg border border-gray-200 p-5">
          <dt className="text-sm text-gray-500">Registration fee</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">
            {registrationFeeEnabled ? formatPaiseAsInr(registrationFeePaise) : "None"}
          </dd>
        </div>
        <div className="rounded-lg border border-gray-200 p-5">
          <dt className="text-sm text-gray-500">Payout schedule</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">Fortnightly</dd>
        </div>
        <div className="rounded-lg border border-gray-200 p-5">
          <dt className="text-sm text-gray-500">Minimum payout</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{formatPaiseAsInr(payoutMinimumPaise)}</dd>
        </div>
      </dl>

      <p className="mt-8 text-sm text-gray-500">
        The registration fee and commission structure are under active legal/compliance review —
        see <code>docs/COMPLIANCE.md</code>.
      </p>

      <Link
        href="/register"
        className="mt-8 inline-block rounded-md bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700"
      >
        Create an account
      </Link>
    </div>
  );
}
