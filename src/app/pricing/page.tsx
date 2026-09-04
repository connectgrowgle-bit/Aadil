import type { Metadata } from "next";
import Link from "next/link";
import { listServices, getServiceBySlug } from "@/lib/repository";
import { formatPaiseAsInr } from "@/lib/money";

export const metadata: Metadata = { title: "Pricing" };

export default async function PricingPage() {
  const summaries = await listServices();
  const details = await Promise.all(summaries.map((s) => getServiceBySlug(s.slug)));

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Pricing</h1>
      <p className="mt-2 text-gray-600">
        Every price on this page is read from the database at request time — the number shown
        here is the number checkout would charge.
      </p>
      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {details
          .filter((d): d is NonNullable<typeof d> => d !== null)
          .map((service) => (
            <div key={service.slug} className="rounded-lg border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900">{service.name}</h2>
              <ul className="mt-4 space-y-3">
                {service.plans.map((plan) => (
                  <li key={plan.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{plan.name}</span>
                    <span className="font-medium text-gray-900">{formatPaiseAsInr(plan.pricePaise)}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={`/${service.slug}`}
                className="mt-6 block rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-700"
              >
                View details
              </Link>
            </div>
          ))}
      </div>
    </div>
  );
}
