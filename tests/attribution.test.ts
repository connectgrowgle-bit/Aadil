import { describe, it, expect } from "vitest";
import { generateClickToken, signClickToken, verifyClickCookie } from "@/lib/attribution/cookie";
import { resolveAttributionFromCookie } from "@/lib/attribution/resolve";
import { createTestUser, createTestAffiliate, createTestAffiliateLink, createTestAffiliateClick } from "./helpers/fixtures";

describe("signClickToken / verifyClickCookie", () => {
  it("round-trips a valid signed cookie", () => {
    const token = generateClickToken();
    const cookieValue = signClickToken(token);
    expect(verifyClickCookie(cookieValue)).toBe(token);
  });

  it("rejects a tampered click token (signature no longer matches)", () => {
    const token = generateClickToken();
    const cookieValue = signClickToken(token);
    const tampered = cookieValue.replace(token, generateClickToken());
    expect(verifyClickCookie(tampered)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = generateClickToken();
    const cookieValue = signClickToken(token);
    const [t] = cookieValue.split(".");
    expect(verifyClickCookie(`${t}.${"0".repeat(64)}`)).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(verifyClickCookie("not-a-valid-cookie-value")).toBeNull();
    expect(verifyClickCookie(undefined)).toBeNull();
    expect(verifyClickCookie("")).toBeNull();
  });
});

describe("resolveAttributionFromCookie", () => {
  it("resolves a valid cookie to the ACTIVE affiliate behind the click", async () => {
    const affiliateOwner = await createTestUser();
    const affiliate = await createTestAffiliate(affiliateOwner.id, "ACTIVE");
    const link = await createTestAffiliateLink(affiliate.id);
    const click = await createTestAffiliateClick(link.id);

    const resolved = await resolveAttributionFromCookie(signClickToken(click.clickToken));
    expect(resolved?.affiliateId).toBe(affiliate.id);
    expect(resolved?.affiliateClickId).toBe(click.id);
  });

  it("returns null for a click behind a SUSPENDED affiliate", async () => {
    const affiliateOwner = await createTestUser();
    const affiliate = await createTestAffiliate(affiliateOwner.id, "SUSPENDED");
    const link = await createTestAffiliateLink(affiliate.id);
    const click = await createTestAffiliateClick(link.id);

    expect(await resolveAttributionFromCookie(signClickToken(click.clickToken))).toBeNull();
  });

  it("returns null for an unknown click token, even if correctly signed", async () => {
    expect(await resolveAttributionFromCookie(signClickToken(generateClickToken()))).toBeNull();
  });

  it("returns null for a missing cookie", async () => {
    expect(await resolveAttributionFromCookie(undefined)).toBeNull();
  });
});
