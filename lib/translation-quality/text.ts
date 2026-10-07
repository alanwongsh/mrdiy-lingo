export function htmlToText(value: string): string {
  return (value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeSpace(value: string): string {
  return htmlToText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WEB_ADDRESS =
  /^(?:https?:\/\/|\/\/|www\.)|(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9-]+\.)+(?:com|net|org|edu|gov|io|co|my|sg|id|th|vn|ph|uk|au|nz|cn|hk|tw|jp|kr)(?:[./?#]|$)/i;

function looksLikeWebAddress(token: string): boolean {
  const value = token.replace(/[),.;]+$/g, "");
  return value.includes("://") || WEB_ADDRESS.test(value);
}

function visibleWindow(html: string, index: number, length: number): string {
  const windowStart = Math.max(0, index - 48);
  const windowEnd = Math.min(html.length, index + Math.max(length, 1) + 48);
  let slice = html.slice(windowStart, windowEnd);
  if (windowStart > 0) {
    const before = html.slice(0, windowStart);
    const lastLt = before.lastIndexOf("<");
    const lastGt = before.lastIndexOf(">");
    if (lastLt > lastGt) {
      const close = slice.indexOf(">");
      slice = close === -1 ? "" : slice.slice(close + 1);
    }
  }
  const snippet = slice.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return `${windowStart > 0 ? "…" : ""}${snippet}${windowEnd < html.length ? "…" : ""}`.slice(0, 180);
}

/** A terminology hit inside a tag or web address should not be rewritten. */
export function termHitContext(
  html: string,
  index: number,
  length: number
): { hidden: boolean; inLink: boolean; snippet: string } {
  if (!html || index < 0 || index >= html.length) {
    return { hidden: false, inLink: false, snippet: "" };
  }
  const before = html.slice(0, index);
  const lastLt = before.lastIndexOf("<");
  const lastGt = before.lastIndexOf(">");
  if (lastLt > lastGt) {
    const end = html.indexOf(">", index);
    const tag = html.slice(lastLt, end === -1 ? html.length : end + 1);
    const address = tag.match(/\b(?:href|src)\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const inLink = Boolean(address) || /\b(?:href|src)\s*=/i.test(tag);
    const snippet = (address || tag).replace(/\s+/g, " ").trim().slice(0, 160);
    return { hidden: true, inLink, snippet };
  }
  let start = index;
  let end = Math.min(html.length, index + Math.max(length, 1));
  while (start > 0 && !/\s/.test(html[start - 1] ?? "") && html[start - 1] !== ">") {
    start -= 1;
  }
  while (end < html.length && !/\s/.test(html[end] ?? "") && html[end] !== "<") {
    end += 1;
  }
  const token = html.slice(start, end);
  if (looksLikeWebAddress(token)) {
    return { hidden: true, inLink: true, snippet: token.slice(0, 160) };
  }
  return {
    hidden: false,
    inLink: false,
    snippet: visibleWindow(html, index, length),
  };
}

export function findTerm(
  haystack: string,
  needle: string
): Array<{ index: number; matched: string }> {
  const trimmed = needle.trim();
  if (!trimmed || !haystack) return [];
  const asciiWord = /^[\x00-\x7F]+$/.test(trimmed) && /[A-Za-z0-9]/.test(trimmed);
  const pattern = asciiWord
    ? `(?:^|[^A-Za-z0-9])(${escapeRegExp(trimmed)})(?=$|[^A-Za-z0-9])`
    : escapeRegExp(trimmed);
  const re = new RegExp(pattern, asciiWord ? "gi" : "g");
  const hits: Array<{ index: number; matched: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(haystack))) {
    const matched = asciiWord ? match[1] : match[0];
    const index = asciiWord ? match.index + match[0].lastIndexOf(matched) : match.index;
    hits.push({ index, matched });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return hits;
}

export function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const max = Math.max(left.length, right.length);
  if (!max) return 1;
  if (left.length > 400 || right.length > 400) return tokenSimilarity(left, right);
  const distance = levenshtein(left, right);
  return 1 - distance / max;
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return (2 * shared) / (a.size + b.size);
}

function levenshtein(left: string, right: string): number {
  const rows = left.length + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function paragraphs(value: string): string[] {
  return htmlToText(value)
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function readableQualityError(value: string): string {
  const trimmed = value.trim();
  let message = trimmed;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
      const inner = parsed.error?.message || parsed.message;
      if (typeof inner === "string" && inner.trim()) message = inner.trim();
    } catch {
      message = trimmed;
    }
  }
  if (/is no longer available/i.test(message)) {
    return "The quality model is no longer available. Analyze again to use the current model.";
  }
  return message.slice(0, 240);
}

export function safeErrorMessage(error: unknown, secret = ""): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Quality analysis failed.";
  const redacted = secret ? message.split(secret).join("[redacted]") : message;
  return readableQualityError(redacted);
}

export function languageCompatible(entry: string, article: string): boolean {
  const left = entry.trim().toLowerCase();
  const right = article.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return left === right.split("-")[0] || right === left.split("-")[0];
}

export const ANALYSIS_FAILED_MESSAGE =
  "Quality analysis failed. Please try again.";
