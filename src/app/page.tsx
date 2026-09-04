import Link from "next/link";
import { listServices } from "@/lib/repository";

export default async function HomePage() {
  const services = await listServices();

  return (
    <div>
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Performance marketing, sold directly.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
          GrowEazzy is not a marketplace. We sell three services ourselves — real estate buyer
          leads, an AI content avatar, and unlimited video editing — and pay a single-level
          affiliate commission on referrals.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link
            href="/services"
            className="rounded-md bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            Explore services
          </Link>
          <Link
            href="/affiliate"
            className="rounded-md border border-gray-300 px-6 py-3 text-sm font-medium text-gray-900 hover:bg-gray-50"
          >
            Become an affiliate
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 sm:grid-cols-3">
          {services.map((service) => (
            <Link
              key={service.slug}
              href={`/${service.slug}`}
              className="rounded-lg border border-gray-200 p-6 transition hover:border-gray-400 hover:shadow-sm"
            >
              <h2 className="text-lg font-semibold text-gray-900">{service.name}</h2>
              <p className="mt-2 text-sm text-gray-600">{service.shortDescription}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
