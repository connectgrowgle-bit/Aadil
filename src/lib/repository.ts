/**
 * The repository seam (docs/ARCHITECTURE.md §4). No component under
 * src/app renders content it fetched itself — everything comes through
 * these async functions. The service catalogue is DB-backed (the
 * `services` / `service_plans` tables already exist and are seeded by
 * `npm run seed:catalogue`); marketing copy with no corresponding table
 * in the spec's schema (FAQ, about, legal policies) is static content
 * returned the same way. Because every signature here is already async
 * and already shaped like a database read, a page never needs to change
 * when a function's body does — that's the whole point of the seam.
 */
import { eq, and, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { services, servicePlans } from "@/lib/db/schema";
import { sanitizeRichText } from "@/lib/sanitize-html";

export interface ServiceSummary {
  slug: string;
  name: string;
  shortDescription: string;
}

export interface ServicePlanView {
  id: string;
  name: string;
  pricePaise: number;
}

export interface ServiceDetail extends ServiceSummary {
  id: string;
  longDescriptionHtml: string;
  plans: ServicePlanView[];
}

export async function listServices(): Promise<ServiceSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      slug: services.slug,
      name: services.name,
      shortDescription: services.shortDescription,
    })
    .from(services)
    .where(eq(services.isPublished, true));
  return rows;
}

export async function getServiceBySlug(slug: string): Promise<ServiceDetail | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(services)
    .where(and(eq(services.slug, slug), eq(services.isPublished, true)))
    .limit(1);
  const service = rows[0];
  if (!service) return null;

  const plans = await listPlansForService(service.id);
  return {
    id: service.id,
    slug: service.slug,
    name: service.name,
    shortDescription: service.shortDescription,
    // Sanitized here, at the single read boundary, so every caller of
    // getServiceBySlug gets HTML that is safe for dangerouslySetInnerHTML
    // without having to remember to do it themselves.
    longDescriptionHtml: sanitizeRichText(service.longDescriptionHtml),
    plans,
  };
}

export async function listPlansForService(serviceId: string): Promise<ServicePlanView[]> {
  const db = getDb();
  const rows = await db
    .select({ id: servicePlans.id, name: servicePlans.name, pricePaise: servicePlans.pricePaise })
    .from(servicePlans)
    .where(and(eq(servicePlans.serviceId, serviceId), eq(servicePlans.isActive, true)))
    .orderBy(asc(servicePlans.createdAt));
  return rows;
}

// --- Static marketing content -------------------------------------------
// No table in the spec's 49-table schema exists for this content. It is
// exposed through the same async seam so a future CMS-backed
// implementation is a body swap, not a page rewrite.

export interface FaqEntry {
  question: string;
  answer: string;
}

export async function listFaqs(): Promise<FaqEntry[]> {
  return [
    {
      question: "Is GrowEazzy a marketplace?",
      answer:
        "No. GrowEazzy sells three of its own services directly — we are not a marketplace connecting third-party sellers to buyers.",
    },
    {
      question: "How does the affiliate programme work?",
      answer:
        "It is single-level: you earn commission only on sales you personally refer, never on people you recruit as affiliates.",
    },
    {
      question: "Is the ₹2,000 registration fee mandatory?",
      answer:
        "It is currently required to access the affiliate training portal, and is admin-configurable — GrowEazzy can switch it off entirely.",
    },
    {
      question: "When do affiliates get paid?",
      answer:
        "Payouts run fortnightly, once your available commission balance is above ₹1,000, after TDS deduction.",
    },
  ];
}

export interface AboutContent {
  heading: string;
  bodyHtml: string;
}

export async function getAboutContent(): Promise<AboutContent> {
  return {
    heading: "About GrowEazzy",
    bodyHtml: sanitizeRichText(
      "<p>GrowEazzy is a single-seller Indian performance marketing platform. We sell Real Estate Qualified Buyers, AI Content Avatar, and Unlimited Video Editing directly, and run a single-level affiliate programme for people who want to refer them.</p>",
    ),
  };
}

export interface LegalDocument {
  title: string;
  effectiveDate: string;
  bodyHtml: string;
}

export async function getLegalDocument(
  kind: "terms" | "privacy" | "refund-policy",
): Promise<LegalDocument> {
  const docs: Record<typeof kind, LegalDocument> = {
    terms: {
      title: "Terms of Service",
      effectiveDate: "2026-01-01",
      bodyHtml: sanitizeRichText(
        "<p>Draft terms. See docs/COMPLIANCE.md — this text has not been reviewed by counsel and must not be used as-is.</p>",
      ),
    },
    privacy: {
      title: "Privacy Policy",
      effectiveDate: "2026-01-01",
      bodyHtml: sanitizeRichText(
        "<p>Draft privacy policy. See docs/COMPLIANCE.md — this text has not been reviewed by counsel and must not be used as-is.</p>",
      ),
    },
    "refund-policy": {
      title: "Refund Policy",
      effectiveDate: "2026-01-01",
      bodyHtml: sanitizeRichText(
        "<p>Draft refund policy. See docs/COMPLIANCE.md — this text has not been reviewed by counsel and must not be used as-is.</p>",
      ),
    },
  };
  return docs[kind];
}
