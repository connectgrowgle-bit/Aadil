import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServiceBySlug } from "@/lib/repository";
import { formatPaiseAsInr } from "@/lib/money";

// This route must resolve any published service slug on any public URL,
// including one carrying `?ref=` — the attribution requirement in
// docs/ARCHITECTURE.md §8. Next.js's static-first route matching means
// literal routes (e.g. /pricing, /about) always win over this dynamic
// catch, so there is no collision risk from adding a new static page later
// as long as it doesn't share a slug with a service.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const service = await getServiceBySlug(slug);
  return { title: service?.name ?? "Not found" };
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = await getServiceBySlug(slug);
  if (!service) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">{service.name}</h1>
      <p className="mt-2 text-lg text-gray-600">{service.shortDescription}</p>
      <div
        className="prose mt-8 max-w-none text-gray-700"
        dangerouslySetInnerHTML={{ __html: service.longDescriptionHtml }}
      />

      <div className="mt-10 space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">Plans</h2>
        {service.plans.map((plan) => (
          <div key={plan.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-5">
            <div>
              <p className="font-medium text-gray-900">{plan.name}</p>
            </div>
            {/* Price is read server-side from the database (Rule 4) — this
                is exactly the string the checkout flow would charge. */}
            <p className="text-lg font-semibold text-gray-900">{formatPaiseAsInr(plan.pricePaise)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
