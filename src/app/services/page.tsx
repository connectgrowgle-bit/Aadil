import Link from "next/link";
import type { Metadata } from "next";
import { listServices } from "@/lib/repository";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  const services = await listServices();

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Services</h1>
      <p className="mt-2 text-gray-600">Three services. Sold directly by GrowEazzy, not a marketplace listing.</p>
      <div className="mt-10 space-y-6">
        {services.map((service) => (
          <Link
            key={service.slug}
            href={`/${service.slug}`}
            className="block rounded-lg border border-gray-200 p-6 hover:border-gray-400 hover:shadow-sm"
          >
            <h2 className="text-xl font-semibold text-gray-900">{service.name}</h2>
            <p className="mt-2 text-gray-600">{service.shortDescription}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
