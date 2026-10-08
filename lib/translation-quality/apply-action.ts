import type { QualityAction, QualityTargetField } from "@/lib/translation-quality/types";
import type { SourceContentFields } from "@/lib/types";

function fieldKey(field: QualityTargetField): keyof SourceContentFields {
  if (field === "content") return "body";
  return field;
}

const BLOCK_TAG =
  /<(?:\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|section|article|header|tr|table)|br)\b/i;

function normalizedText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Text after the heading (or earlier block) that the suggestion still starts with. */
function textAfterPrefix(source: string, prefix: string) {
  const prefixNorm = normalizedText(prefix);
  if (!prefixNorm) return source.trim();
  let sourceIndex = 0;
  let prefixIndex = 0;
  const folded = source.toLowerCase();
  while (prefixIndex < prefixNorm.length && sourceIndex < source.length) {
    if (/\s/.test(source[sourceIndex])) {
      if (prefixNorm[prefixIndex] === " ") {
        prefixIndex += 1;
        while (sourceIndex < source.length && /\s/.test(source[sourceIndex])) sourceIndex += 1;
      } else {
        while (sourceIndex < source.length && /\s/.test(source[sourceIndex])) sourceIndex += 1;
      }
      continue;
    }
    if (folded[sourceIndex] !== prefixNorm[prefixIndex]) return null;
    sourceIndex += 1;
    prefixIndex += 1;
  }
  if (prefixIndex < prefixNorm.length) return null;
  while (sourceIndex < source.length && /\s/.test(source[sourceIndex])) sourceIndex += 1;
  return source.slice(sourceIndex);
}

type VisibleUnit = { ch: string; start: number; end: number; block: boolean };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntityAt(html: string, index: number): { char: string; end: number } | null {
  if (html[index] !== "&") return null;
  const end = html.indexOf(";", index + 1);
  if (end < 0 || end - index > 16) return null;
  const body = html.slice(index + 1, end);
  if (body.startsWith("#")) {
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0) return null;
    try {
      return { char: String.fromCodePoint(code), end: end + 1 };
    } catch {
      return null;
    }
  }
  const char = NAMED_ENTITIES[body.toLowerCase()];
  if (!char) return null;
  return { char, end: end + 1 };
}

/** Visible characters in document order, with entities decoded and tags skipped. */
function visibleUnits(html: string): VisibleUnit[] {
  const units: VisibleUnit[] = [];
  let index = 0;
  while (index < html.length) {
    if (html[index] === "<") {
      const close = html.indexOf(">", index + 1);
      if (close < 0) break;
      const tag = html.slice(index, close + 1);
      const hidden = tag.match(/^<(script|style)\b/i);
      if (hidden) {
        const name = hidden[1];
        const rest = html.slice(close + 1);
        const end = rest.search(new RegExp(`</${name}\\s*>`, "i"));
        index = end < 0 ? html.length : close + 1 + end + rest.match(new RegExp(`</${name}\\s*>`, "i"))![0].length;
        continue;
      }
      if (BLOCK_TAG.test(tag) && (/^<br\b/i.test(tag) || tag.startsWith("</"))) {
        units.push({ ch: "\n", start: index, end: close + 1, block: true });
      }
      index = close + 1;
      continue;
    }
    const entity = decodeEntityAt(html, index);
    if (entity) {
      units.push({ ch: entity.char, start: index, end: entity.end, block: false });
      index = entity.end;
      continue;
    }
    units.push({ ch: html[index], start: index, end: index + 1, block: false });
    index += 1;
  }
  return units;
}

/** Same plain text `htmlToText` produces, mapped back to visible units. */
function plainTextMap(units: VisibleUnit[]): { text: string; units: number[] } {
  const chars: Array<{ ch: string; unit: number }> = [];
  for (let index = 0; index < units.length; index += 1) {
    if (units[index].ch !== "\r") chars.push({ ch: units[index].ch, unit: index });
  }
  const collapsed: typeof chars = [];
  for (let index = 0; index < chars.length; index += 1) {
    if (/[ \t]/.test(chars[index].ch)) {
      let next = index;
      while (next < chars.length && /[ \t]/.test(chars[next].ch)) next += 1;
      if (next < chars.length && chars[next].ch === "\n") {
        index = next - 1;
        continue;
      }
    }
    collapsed.push(chars[index]);
  }
  const squeezed: typeof chars = [];
  let newlines = 0;
  for (const item of collapsed) {
    if (item.ch === "\n") {
      newlines += 1;
      if (newlines <= 2) squeezed.push(item);
      continue;
    }
    newlines = 0;
    squeezed.push(item);
  }
  let start = 0;
  let end = squeezed.length;
  while (start < end && /\s/.test(squeezed[start].ch)) start += 1;
  while (end > start && /\s/.test(squeezed[end - 1].ch)) end -= 1;
  const slice = squeezed.slice(start, end);
  let text = "";
  const mapped: number[] = [];
  for (const item of slice) {
    for (const ch of item.ch.toLowerCase()) {
      text += ch;
      mapped.push(item.unit);
    }
  }
  return { text, units: mapped };
}

function escapeHtmlText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function spliceHtml(html: string, edits: Array<{ start: number; end: number; text: string }>) {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let out = html;
  for (const edit of ordered) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

const INLINE_TAG = new Set(["a", "strong", "em", "b", "i", "u", "s", "span", "mark", "sub", "sup"]);

function readTag(html: string, index: number) {
  if (html[index] !== "<") return null;
  const close = html.indexOf(">", index + 1);
  if (close < 0) return null;
  const raw = html.slice(index, close + 1);
  const parsed = raw.match(/^<(\/?)([a-zA-Z0-9]+)/);
  if (!parsed) return { start: index, end: close + 1, raw, inline: false, closing: false, self: false, name: "" };
  const name = parsed[2].toLowerCase();
  return {
    start: index,
    end: close + 1,
    raw,
    name,
    closing: parsed[1] === "/",
    self: /\/>$/.test(raw),
    inline: INLINE_TAG.has(name),
  };
}

function visibleString(html: string) {
  return visibleUnits(html)
    .filter((unit) => !unit.block && unit.ch !== "\n" && unit.ch !== "\r")
    .map((unit) => unit.ch)
    .join("");
}

/** Widen a text range so an inline tag that crosses it is rewritten as a whole tag. */
function inlineBounds(html: string, start: number, end: number) {
  const stack: { name: string; from: number }[] = [];
  let index = 0;
  while (index < start) {
    const tag = readTag(html, index);
    if (!tag) {
      index += 1;
      continue;
    }
    if (tag.end > start) break;
    if (tag.inline && !tag.self) {
      if (tag.closing) {
        for (let at = stack.length - 1; at >= 0; at -= 1) {
          if (stack[at].name === tag.name) {
            stack.splice(at, 1);
            break;
          }
        }
      } else {
        stack.push({ name: tag.name, from: tag.start });
      }
    }
    index = tag.end;
  }
  const from = stack.length ? stack[0].from : start;
  const open: { name: string }[] = [];
  index = from;
  let to = end;
  while (index < html.length) {
    if (index >= end && open.length === 0) {
      to = index;
      break;
    }
    if (html[index] !== "<") {
      index += 1;
      continue;
    }
    const tag = readTag(html, index);
    if (!tag) break;
    if (tag.inline && !tag.self) {
      if (tag.closing) {
        for (let at = open.length - 1; at >= 0; at -= 1) {
          if (open[at].name === tag.name) {
            open.splice(at, 1);
            break;
          }
        }
      } else {
        open.push({ name: tag.name });
      }
    }
    index = tag.end;
  }
  return { from, to };
}

function matchingClose(html: string, from: number, name: string) {
  let depth = 1;
  let index = from;
  while (index < html.length) {
    const tag = readTag(html, index);
    if (!tag) {
      index += 1;
      continue;
    }
    if (tag.inline && tag.name === name && !tag.self) {
      if (tag.closing) {
        depth -= 1;
        if (depth === 0) return tag;
      } else {
        depth += 1;
      }
    }
    index = tag.end;
  }
  return null;
}

function topInline(slice: string) {
  const found: { open: string; close: string; innerHtml: string; visible: string }[] = [];
  let index = 0;
  while (index < slice.length) {
    const tag = readTag(slice, index);
    if (!tag) {
      index += 1;
      continue;
    }
    if (!tag.inline || tag.closing || tag.self) {
      index = tag.end;
      continue;
    }
    const close = matchingClose(slice, tag.end, tag.name);
    if (!close) {
      index = tag.end;
      continue;
    }
    const innerHtml = slice.slice(tag.end, close.start);
    found.push({
      open: tag.raw,
      close: close.raw,
      innerHtml,
      visible: visibleString(innerHtml),
    });
    index = close.end;
  }
  return found;
}

function placeWrap(
  visible: string,
  text: string,
  taken: Array<{ start: number; end: number }>
) {
  const haystack = text.toLowerCase();
  const needle = visible.toLowerCase();
  if (!needle.trim()) return null;
  const overlaps = (start: number, end: number) =>
    taken.some((claim) => start < claim.end && end > claim.start);
  const claim = (start: number) => {
    const end = start + needle.length;
    if (overlaps(start, end)) return null;
    return { start, end };
  };
  const exact = haystack.indexOf(needle);
  if (exact >= 0) {
    const placed = claim(exact);
    if (placed) return placed;
  }
  let best: { start: number; end: number } | null = null;
  const min = Math.min(needle.length, 4);
  for (let size = needle.length - 1; size >= min; size -= 1) {
    if (best && best.end - best.start >= size) break;
    for (let offset = 0; offset + size <= needle.length; offset += 1) {
      const part = needle.slice(offset, offset + size).trim();
      if (part.length < min) continue;
      const at = haystack.indexOf(part);
      if (at < 0 || overlaps(at, at + part.length)) continue;
      best = { start: at, end: at + part.length };
      break;
    }
  }
  return best;
}

/** Replace visible words without deleting a link or other inline tag that crosses them. */
function markedReplacement(html: string, start: number, end: number, replacement: string) {
  if (!html.slice(start, end).includes("<")) return null;
  const bounds = inlineBounds(html, start, end);
  const region = html.slice(bounds.from, bounds.to);
  const wraps = topInline(region).filter((wrap) => wrap.visible.trim());
  if (!wraps.length) return null;
  const prefix = visibleString(html.slice(bounds.from, start));
  const suffix = visibleString(html.slice(end, bounds.to));
  const text = `${prefix}${replacement}${suffix}`;
  const claims: { start: number; end: number; open: string; close: string; innerHtml: string; visible: string }[] = [];
  const taken: Array<{ start: number; end: number }> = [];
  for (const wrap of [...wraps].sort((a, b) => b.visible.length - a.visible.length)) {
    const placed = placeWrap(wrap.visible, text, taken);
    if (!placed) continue;
    taken.push(placed);
    claims.push({ ...placed, open: wrap.open, close: wrap.close, innerHtml: wrap.innerHtml, visible: wrap.visible });
  }
  claims.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const claim of claims) {
    out += escapeHtmlText(text.slice(cursor, claim.start));
    const inner = text.slice(claim.start, claim.end);
    const keepInner = inner.toLowerCase() === claim.visible.toLowerCase();
    out += claim.open + (keepInner ? claim.innerHtml : escapeHtmlText(inner)) + claim.close;
    cursor = claim.end;
  }
  out += escapeHtmlText(text.slice(cursor));
  return { from: bounds.from, to: bounds.to, html: out };
}

function putText(html: string, start: number, end: number, text: string, escape: boolean) {
  const marked = markedReplacement(html, start, end, text);
  if (marked) return { start: marked.from, end: marked.to, text: marked.html };
  return { start, end, text: escape ? escapeHtmlText(text) : text };
}

function replaceAcrossTags(html: string, phrase: string, replacement: string): string | null {
  const needle = phrase.trim().toLowerCase();
  if (!needle) return null;
  const units = visibleUnits(html);
  const plain = plainTextMap(units);
  const at = plain.text.indexOf(needle);
  if (at < 0 || at + needle.length > plain.units.length) return null;
  const from = plain.units[at];
  const to = plain.units[at + needle.length - 1];
  const groups: number[][] = [];
  let group: number[] = [];
  for (let index = from; index <= to; index += 1) {
    if (units[index].block) {
      if (group.length) groups.push(group);
      group = [];
      continue;
    }
    group.push(index);
  }
  if (group.length) groups.push(group);
  if (!groups.length) return null;

  const inMarkup = html.slice(0, units[groups[0][0]].start).includes("<");
  if (groups.length === 1) {
    const first = units[groups[0][0]];
    const last = units[groups[0][groups[0].length - 1]];
    return spliceHtml(html, [putText(html, first.start, last.end, replacement, inMarkup)]);
  }

  const firstText = groups[0].map((index) => units[index].ch).join("");
  const remainder = textAfterPrefix(replacement, firstText) ?? replacement;
  const next = groups[1];
  const edits: Array<{ start: number; end: number; text: string }> = [
    putText(
      html,
      units[next[0]].start,
      units[next[next.length - 1]].end,
      remainder,
      inMarkup
    ),
  ];
  for (const extra of groups.slice(2)) {
    edits.push({
      start: units[extra[0]].start,
      end: units[extra[extra.length - 1]].end,
      text: "",
    });
  }
  return spliceHtml(html, edits);
}

function applyToText(current: string, action: QualityAction): string {
  const original = action.originalText ?? "";
  const proposed = action.proposedText ?? "";

  if (
    (action.actionType === "replace" || action.actionType === "rewrite") &&
    original
  ) {
    const exact = current.indexOf(original);
    const folded =
      exact >= 0 ? -1 : current.toLowerCase().indexOf(original.toLowerCase());
    const index = exact >= 0 ? exact : folded;
    if (index >= 0) {
      return (
        current.slice(0, index) +
        proposed +
        current.slice(index + original.length)
      );
    }
    const across = replaceAcrossTags(current, original, proposed);
    if (across && across !== current) return across;
  }

  if (action.actionType === "delete" && original) {
    const index = current.indexOf(original);
    if (index >= 0) {
      return current.slice(0, index) + current.slice(index + original.length);
    }
  }

  if (action.actionType === "insert" && proposed) {
    const at = action.startOffset;
    if (typeof at === "number" && at >= 0 && at <= current.length) {
      return current.slice(0, at) + proposed + current.slice(at);
    }
    if (!current) return proposed;
    return `${current}${current.endsWith("\n") ? "" : "\n"}${proposed}`;
  }

  if (
    typeof action.startOffset === "number" &&
    typeof action.endOffset === "number" &&
    action.startOffset >= 0 &&
    action.endOffset >= action.startOffset &&
    action.endOffset <= current.length &&
    (!original || current.slice(action.startOffset, action.endOffset) === original)
  ) {
    return (
      current.slice(0, action.startOffset) +
      proposed +
      current.slice(action.endOffset)
    );
  }

  throw new Error("This suggestion no longer matches the translation.");
}

/** Apply one suggestion to an editor draft. This does not write to the database. */
export function applyQualityAction(
  fields: SourceContentFields,
  action: QualityAction
): SourceContentFields {
  const key = fieldKey(action.targetField);
  const current = fields[key] ?? "";
  const next = applyToText(current, action);
  if (next === current) {
    throw new Error("This suggestion no longer matches the translation.");
  }
  return { ...fields, [key]: next };
}
