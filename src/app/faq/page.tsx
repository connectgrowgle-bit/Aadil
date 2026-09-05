import type { Metadata } from "next";
import { listFaqs } from "@/lib/repository";

export const metadata: Metadata = { title: "FAQ" };

export default async function FaqPage() {
  const faqs = await listFaqs();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Frequently asked questions</h1>
      <dl className="mt-10 space-y-8">
        {faqs.map((faq) => (
          <div key={faq.question}>
            <dt className="font-semibold text-gray-900">{faq.question}</dt>
            <dd className="mt-2 text-gray-600">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
