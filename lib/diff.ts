export type DiffToken = {
  type: "equal" | "add" | "remove";
  text: string;
};

/**
 * Canonicalize TipTap / import HTML so cosmetic markup noise
 * (li>p wrappers, class attrs, attribute order) does not flood comparisons.
 */
export function normalizeHtmlForDiff(html: string): string {
  let s = (html || "").trim();
  if (!s) return "";

  // TipTap wraps list item text in <p>
  s = s.replace(/<li(\s[^>]*)?>\s*<p(\s[^>]*)?>/gi, "<li$1>");
  s = s.replace(/<\/p>\s*<\/li>/gi, "</li>");

  // Drop editor-only classes
  s = s.replace(/\s+class="[^"]*"/gi, "");
  s = s.replace(/\s+class='[^']*'/gi, "");

  // Stable <br>
  s = s.replace(/<br\s*\/?>/gi, "<br>");

  // Stable <a> attribute order: href, target, rel
  s = s.replace(/<a\s+([^>]*?)>/gi, (_match, rawAttrs: string) => {
    const attrs = String(rawAttrs);
    const pick = (name: string) => {
      const m =
        attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) ||
        attrs.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
      return m?.[1];
    };
    const parts: string[] = [];
    const href = pick("href");
    const target = pick("target");
    const rel = pick("rel");
    if (href != null) parts.push(`href="${href}"`);
    if (target) parts.push(`target="${target}"`);
    if (rel) parts.push(`rel="${rel}"`);
    return parts.length ? `<a ${parts.join(" ")}>` : "<a>";
  });

  // Collapse whitespace between tags; keep single spaces in text
  s = s.replace(/>\s+</g, "><");
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

/** Strip tags to readable plain text for human-friendly diffs. */
export function htmlToPlainTextForDiff(html: string): string {
  let s = normalizeHtmlForDiff(html);
  if (!s) return "";

  // Decode a few common entities before stripping tags
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Block / list structure → newlines so sections stay readable
  s = s.replace(/<\/(h[1-6]|p|div|blockquote|li|tr)>/gi, "\n");
  s = s.replace(/<(br|hr)\s*\/?>/gi, "\n");
  s = s.replace(/<\/(ul|ol|table)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");

  // Keep link destination in plain text when useful
  s = s.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      if (!label) return href;
      if (label === href || label.includes(href.replace(/^https?:\/\//, ""))) {
        return label;
      }
      return `${label} (${href})`;
    }
  );

  // Drop remaining tags
  s = s.replace(/<[^>]+>/g, "");
  // Collapse spaces inside lines; keep paragraph breaks
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((line, i, arr) => line.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

function tokenize(text: string): string[] {
  if (!text) return [];
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Word-/tag-level LCS diff for readable translation comparison. */
export function diffWords(before: string, after: string): DiffToken[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  // Guard huge bodies — fall back to coarse line-ish chunks if needed
  if (n * m > 4_000_000) {
    return diffCoarse(before, after);
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      tokens.push({ type: "equal", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ type: "remove", text: a[i] });
      i += 1;
    } else {
      tokens.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    tokens.push({ type: "remove", text: a[i] });
    i += 1;
  }
  while (j < m) {
    tokens.push({ type: "add", text: b[j] });
    j += 1;
  }
  return mergeAdjacent(tokens);
}

/** Prefer this for article HTML bodies — compares readable plain text. */
export function diffHtml(before: string, after: string): DiffToken[] {
  return diffWords(htmlToPlainTextForDiff(before), htmlToPlainTextForDiff(after));
}

function diffCoarse(before: string, after: string): DiffToken[] {
  if (before === after) return [{ type: "equal", text: before }];
  return [
    ...(before ? [{ type: "remove" as const, text: before }] : []),
    ...(after ? [{ type: "add" as const, text: after }] : []),
  ];
}

function mergeAdjacent(tokens: DiffToken[]): DiffToken[] {
  const out: DiffToken[] = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (last && last.type === token.type) {
      last.text += token.text;
    } else {
      out.push({ ...token });
    }
  }
  return out;
}

export function summarizeDiff(tokens: DiffToken[]) {
  let added = 0;
  let removed = 0;
  for (const t of tokens) {
    if (t.type === "add" && t.text.trim()) added += 1;
    if (t.type === "remove" && t.text.trim()) removed += 1;
  }
  return {
    added,
    removed,
    changed: added + removed > 0,
  };
}
