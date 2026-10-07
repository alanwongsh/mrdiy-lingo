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

function replaceAcrossTags(html: string, phrase: string, replacement: string): string | null {
  const needle = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return null;
  const segments: Array<{ start: number; end: number; text: string }> = [];
  let cursor = 0;
  while (cursor < html.length) {
    if (html[cursor] === "<") {
      const end = html.indexOf(">", cursor);
      if (end < 0) break;
      cursor = end + 1;
      continue;
    }
    const next = html.indexOf("<", cursor);
    const end = next < 0 ? html.length : next;
    if (end > cursor) segments.push({ start: cursor, end, text: html.slice(cursor, end) });
    cursor = end;
  }
  let flat = "";
  const map: Array<{ segment: number; offset: number } | null> = [];
  const pushChar = (segment: number | null, offset: number, char: string) => {
    flat += char.toLowerCase();
    map.push(segment == null ? null : { segment, offset });
  };
  for (let index = 0; index < segments.length; index += 1) {
    const text = segments[index].text;
    if (flat && !/\s$/.test(flat) && text && !/^\s/.test(text)) pushChar(null, 0, " ");
    for (let offset = 0; offset < text.length; offset += 1) {
      const char = text[offset];
      if (/\s/.test(char) && /\s$/.test(flat)) continue;
      pushChar(index, offset, /\s/.test(char) ? " " : char);
    }
  }
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  const covered = new Map<number, { from: number; to: number }>();
  let firstSegment = -1;
  for (let index = at; index < at + needle.length && index < map.length; index += 1) {
    const point = map[index];
    if (!point) continue;
    if (firstSegment < 0) firstSegment = point.segment;
    const current = covered.get(point.segment);
    if (!current) covered.set(point.segment, { from: point.offset, to: point.offset + 1 });
    else current.to = Math.max(current.to, point.offset + 1);
  }
  if (firstSegment < 0) return null;

  const coveredIndexes = [...covered.keys()].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const index of coveredIndexes) {
    const previous = groups.at(-1);
    const last = previous?.at(-1);
    if (
      previous &&
      last != null &&
      !BLOCK_TAG.test(html.slice(segments[last].end, segments[index].start))
    ) {
      previous.push(index);
    } else {
      groups.push([index]);
    }
  }

  let insertAt = firstSegment;
  let insertText = replacement;
  if (groups.length > 1) {
    const firstText = groups[0]
      .map((index) => {
        const range = covered.get(index);
        return range ? segments[index].text.slice(range.from, range.to) : "";
      })
      .join(" ");
    const remainder = textAfterPrefix(replacement, firstText);
    insertAt = groups[1][0];
    insertText = remainder ?? replacement;
    for (const index of groups[0]) covered.delete(index);
  }

  let out = "";
  let written = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    out += html.slice(written, segment.start);
    const range = covered.get(index);
    if (!range) out += segment.text;
    else if (index === insertAt) {
      out += segment.text.slice(0, range.from) + insertText + segment.text.slice(range.to);
    } else {
      out += segment.text.slice(0, range.from) + segment.text.slice(range.to);
    }
    written = segment.end;
  }
  return out + html.slice(written);
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
