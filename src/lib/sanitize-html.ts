import sanitizeHtml from "sanitize-html";

/**
 * The one place admin-editable rich text is turned into HTML safe to hand
 * to `dangerouslySetInnerHTML`. Service copy became admin-editable in
 * Phase 9 of the reference build; the original comment claiming "content
 * is always our own" stopped being true at that exact moment
 * (docs/MISTAKES.md item 10). Route every rich-text field through this
 * before it reaches a page, not just the ones editable today.
 */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "em", "ul", "ol", "li", "a", "h2", "h3", "blockquote"],
    allowedAttributes: { a: ["href", "rel", "target"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer nofollow" }),
    },
  });
}
