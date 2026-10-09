/**
 * Source HTML tidy-up before translation, and the editor's auto-link rule.
 *
 * Links are never removed here. The editor's detector used to link bare words with a dot,
 * such as the brand MR.DIY (.diy is a real domain ending), as http://MR.DIY. A real link
 * such as <a href="http://yayasanmrdiy.com">yayasanmrdiy.com</a> has exactly the same shape,
 * so the two cannot be told apart afterwards. The editor prevents the accidental ones instead.
 */

/** Auto-link only text that is written as an address: http(s)://, www., or a path. */
export function looksLikeTypedAddress(text: string) {
  return /^(?:https?:\/\/|www\.)/i.test(text) || /^[^\s/]+\.[^\s/]+\//.test(text);
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
  return mergeAdjacentMarks(html);
}
