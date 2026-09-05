import type { Metadata } from "next";
import { getLegalDocument } from "@/lib/repository";

export const metadata: Metadata = { title: "Terms of Service" };

export default async function TermsPage() {
  const doc = await getLegalDocument("terms");
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">{doc.title}</h1>
      <p className="mt-1 text-sm text-gray-500">Effective {doc.effectiveDate}</p>
      <div className="prose mt-6 max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: doc.bodyHtml }} />
    </div>
  );
}
