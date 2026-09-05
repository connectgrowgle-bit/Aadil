import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "@/lib/sanitize-html";

describe("sanitizeRichText: the docs/MISTAKES.md item 10 guard", () => {
  it("keeps plain paragraph markup", () => {
    expect(sanitizeRichText("<p>Hello <strong>world</strong></p>")).toBe(
      "<p>Hello <strong>world</strong></p>",
    );
  });

  it("strips <script> tags entirely", () => {
    const out = sanitizeRichText('<p>hi</p><script>alert("xss")</script>');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/alert/);
  });

  it("strips an onerror handler smuggled via an unlisted tag", () => {
    const out = sanitizeRichText('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<img/i);
  });

  it("strips a javascript: href", () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps an http(s) href and forces safe rel attributes", () => {
    const out = sanitizeRichText('<a href="https://example.com">link</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toMatch(/rel="[^"]*noopener[^"]*"/);
  });

  it("strips a disallowed tag but keeps its safe text content", () => {
    const out = sanitizeRichText("<div>kept text</div>");
    expect(out).not.toMatch(/<div/i);
    expect(out).toContain("kept text");
  });

  it("strips an inline style attribute (not in the allowlist)", () => {
    const out = sanitizeRichText('<p style="background:url(javascript:alert(1))">x</p>');
    expect(out).not.toMatch(/style=/i);
  });
});
