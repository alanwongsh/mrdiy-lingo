/**
 * Whole-paragraph translation with inline formatting kept.
 *
 * Each paragraph is sent as one string, with its inline tags swapped for short markers
 * such as <t1>…</t1>. The model may move a marker pair with the words it wraps, so
 * "<strong>MR.DIY</strong> website" can become "laman web <strong>MR.DIY</strong>".
 * The reply is accepted only if every marker comes back exactly once and properly nested.
 */

/** Tags that end a paragraph. Everything else (strong, em, a, span, br…) stays inside it. */
const BOUNDARY_TAG =
  /^<(?:!--|\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|section|article|header|footer|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|hr|img|pre|code)\b)/i;
const VOID_TAG = /^<(?:br|wbr)\b/i;
const MARKER = /<(\/?)t(\d+)\s*(\/?)>/gi;

export type MarkedSegment = {
  /** Part indices [start, end) in `html.split(/(<[^>]+>)/g)`. */
  start: number;
  end: number;
  leading: string;
  trailing: string;
  /** Paragraph text with inline tags replaced by markers. */
  marked: string;
  /** Visible text only, for glossary matching and context. */
  plain: string;
  raw: { open: Map<number, string>; close: Map<number, string>; single: Map<number, string> };
};

function tagName(tag: string) {
  const match = tag.match(/^<(\/?)([a-zA-Z0-9]+)/);
  return match ? { closing: match[1] === "/", name: match[2].toLowerCase() } : null;
}

/** Paragraph runs between boundary tags, each with inline tags turned into markers. */
export function markSegments(parts: string[]): MarkedSegment[] {
  const runs: Array<{ start: number; end: number }> = [];
  let start = 0;
  parts.forEach((part, index) => {
    if (part.startsWith("<") && BOUNDARY_TAG.test(part)) {
      if (index > start) runs.push({ start, end: index });
      start = index + 1;
    }
  });
  if (parts.length > start) runs.push({ start, end: parts.length });

  return runs.flatMap((run) => {
    const segment = markRun(parts, run.start, run.end);
    return segment && /[\p{L}\p{N}]/u.test(segment.plain) ? [segment] : [];
  });
}

function markRun(parts: string[], start: number, end: number): MarkedSegment | null {
  // First pass: pair opening and closing tags. A tag left unpaired becomes a single marker.
  const kinds = new Map<number, { id: number; kind: "open" | "close" | "single" }>();
  const stack: Array<{ index: number; name: string; id: number }> = [];
  let nextId = 1;
  for (let index = start; index < end; index += 1) {
    const part = parts[index];
    if (!part.startsWith("<")) continue;
    const parsed = tagName(part);
    if (!parsed || VOID_TAG.test(part) || /\/>$/.test(part)) {
      kinds.set(index, { id: nextId, kind: "single" });
      nextId += 1;
      continue;
    }
    if (!parsed.closing) {
      stack.push({ index, name: parsed.name, id: nextId });
      kinds.set(index, { id: nextId, kind: "open" });
      nextId += 1;
      continue;
    }
    let at = stack.length - 1;
    while (at >= 0 && stack[at].name !== parsed.name) at -= 1;
    if (at < 0) {
      kinds.set(index, { id: nextId, kind: "single" });
      nextId += 1;
      continue;
    }
    // Tags opened inside this one and never closed stand alone.
    for (const orphan of stack.splice(at + 1)) {
      kinds.set(orphan.index, { id: orphan.id, kind: "single" });
    }
    const opener = stack.pop()!;
    kinds.set(index, { id: opener.id, kind: "close" });
  }
  for (const orphan of stack) kinds.set(orphan.index, { id: orphan.id, kind: "single" });

  // Second pass: write the marked text.
  const raw: MarkedSegment["raw"] = { open: new Map(), close: new Map(), single: new Map() };
  let marked = "";
  let plain = "";
  for (let index = start; index < end; index += 1) {
    const part = parts[index];
    const tag = kinds.get(index);
    if (!tag) {
      marked += part;
      plain += part;
      continue;
    }
    raw[tag.kind].set(tag.id, part);
    marked += tag.kind === "open" ? `<t${tag.id}>` : tag.kind === "close" ? `</t${tag.id}>` : `<t${tag.id}/>`;
    if (VOID_TAG.test(part)) plain += " ";
  }
  const leading = marked.match(/^\s*/)?.[0] ?? "";
  const trailing = marked.slice(leading.length).match(/\s*$/)?.[0] ?? "";
  const core = marked.slice(leading.length, marked.length - trailing.length);
  if (!core) return null;
  return {
    start,
    end,
    leading,
    trailing,
    marked: core,
    plain: decodeBasic(plain).replace(/\s+/g, " ").trim(),
    raw,
  };
}

function decodeBasic(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * Put the original tags back into a translated paragraph.
 * Returns null when a marker is missing, repeated, invented, or badly nested,
 * so the caller can fall back to translating run by run.
 */
export function unmarkSegment(segment: MarkedSegment, translated: string): string | null {
  const text = translated.trim();
  if (!text) return null;
  const seen = new Set<string>();
  const stack: number[] = [];
  for (const match of text.matchAll(MARKER)) {
    const id = Number(match[2]);
    const kind = match[1] ? "close" : match[3] ? "single" : "open";
    const key = `${kind}:${id}`;
    if (seen.has(key) || !segment.raw[kind].has(id)) return null;
    seen.add(key);
    if (kind === "open") stack.push(id);
    if (kind === "close" && stack.pop() !== id) return null;
  }
  if (stack.length > 0) return null;
  const expected = segment.raw.open.size + segment.raw.close.size + segment.raw.single.size;
  if (seen.size !== expected) return null;
  const words = text.replace(MARKER, "");
  if (/[<>]/.test(words) || !/[\p{L}\p{N}]/u.test(words)) return null;
  return text.replace(MARKER, (_whole, closing: string, id: string, single: string) => {
    const key = Number(id);
    if (closing) return segment.raw.close.get(key) ?? "";
    if (single) return segment.raw.single.get(key) ?? "";
    return segment.raw.open.get(key) ?? "";
  });
}
