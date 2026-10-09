/**
 * The editor's link detector treats "MR.DIY" as a web address because .diy is a real
 * domain ending, so pasting an article turned every brand mention into <a href="http://MR.DIY">.
 * Those links also split bold text into pieces the translator cannot reorder.
 */

/** Matches a link whose address is just its own text, such as <a href="http://MR.DIY">MR.DIY</a>. */
const LINK = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF = /\bhref\s*=\s*(["'])(.*?)\1/i;

function visible(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/gi, "&").trim();
}

/** A link the editor made from a bare word with a dot, not one someone added on purpose. */
export function isAccidentalLink(href: string, text: string) {
  const bare = href.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!bare || /^www\./i.test(bare) || bare.includes("/")) return false;
  return bare.toLowerCase() === text.trim().toLowerCase();
}

export function unwrapAccidentalLinks(html: string): string {
  return html.replace(LINK, (whole, attributes: string, inner: string) => {
    const href = attributes.match(HREF)?.[2] ?? "";
    return isAccidentalLink(href, visible(inner)) ? inner : whole;
  });
}

/** `<strong>a </strong><strong>b</strong>` becomes `<strong>a b</strong>`. */
export function mergeAdjacentMarks(html: string): string {
  let current = html;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = current.replace(/<\/(strong|em|b|i|u|s)>(\s*)<\1>/gi, "$2");
    if (next === current) return next;
    current = next;
  }
  return current;
}

/** Tidy source HTML before it is split for translation. */
export function cleanSourceHtml(html: string): string {
  return mergeAdjacentMarks(unwrapAccidentalLinks(html));
}
