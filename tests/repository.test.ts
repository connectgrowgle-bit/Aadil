import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { listServices, getServiceBySlug } from "@/lib/repository";
import { createTestServiceWithPlan } from "./helpers/fixtures";

describe("repository: service catalogue seam", () => {
  it("getServiceBySlug returns null for a slug that doesn't exist", async () => {
    expect(await getServiceBySlug("does-not-exist-xyz")).toBeNull();
  });

  it("getServiceBySlug returns the plan(s) with their exact DB-stored price", async () => {
    const fixture = await createTestServiceWithPlan(1_234_500);
    const detail = await getServiceBySlug(fixture.slug);
    expect(detail).not.toBeNull();
    expect(detail!.plans).toHaveLength(1);
    expect(detail!.plans[0]!.pricePaise).toBe(1_234_500);
  });

  it("listServices excludes unpublished services (draft is invisible, not greyed out)", async () => {
    const fixture = await createTestServiceWithPlan();
    const db = getDb();
    await db.update(services).set({ isPublished: false }).where(eq(services.slug, fixture.slug));

    const summaries = await listServices();
    expect(summaries.find((s) => s.slug === fixture.slug)).toBeUndefined();
    expect(await getServiceBySlug(fixture.slug)).toBeNull();
  });

  it("sanitizes longDescriptionHtml before returning it", async () => {
    const db = getDb();
    const fixture = await createTestServiceWithPlan();
    await db
      .update(services)
      .set({ longDescriptionHtml: '<p>ok</p><script>alert(1)</script>' })
      .where(eq(services.slug, fixture.slug));

    const detail = await getServiceBySlug(fixture.slug);
    expect(detail!.longDescriptionHtml).not.toMatch(/script/i);
    expect(detail!.longDescriptionHtml).toContain("<p>ok</p>");
  });
});
