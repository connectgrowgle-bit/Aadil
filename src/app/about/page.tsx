import type { Metadata } from "next";
import { getAboutContent } from "@/lib/repository";

export const metadata: Metadata = { title: "About" };

export default async function AboutPage() {
  const content = await getAboutContent();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-gray-900">{content.heading}</h1>
      <div className="prose mt-6 max-w-none text-gray-700" dangerouslySetInnerHTML={{ __html: content.bodyHtml }} />
    </div>
  );
}
