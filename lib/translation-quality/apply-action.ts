import type { QualityAction, QualityTargetField } from "@/lib/translation-quality/types";
import type { SourceContentFields } from "@/lib/types";

function fieldKey(field: QualityTargetField): keyof SourceContentFields {
  if (field === "content") return "body";
  return field;
}

function replaceAcrossTags(html: string, phrase: string, replacement: string): string | null {
  const needle = phrase.trim().toLowerCase();
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
    segments.push({ start: cursor, end, text: html.slice(cursor, end) });
    cursor = end;
  }
  const flat = segments.map((segment) => segment.text).join("").toLowerCase();
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  let consumed = 0;
  let startSeg = -1;
  let startOff = 0;
  let endSeg = -1;
  let endOff = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const next = consumed + segment.text.length;
    if (startSeg < 0 && at < next) {
      startSeg = index;
      startOff = at - consumed;
    }
    if (at + needle.length <= next) {
      endSeg = index;
      endOff = at + needle.length - consumed;
      break;
    }
    consumed = next;
  }
  if (startSeg < 0 || endSeg < 0) return null;
  let out = "";
  let written = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    out += html.slice(written, segment.start);
    if (index < startSeg || index > endSeg) out += segment.text;
    else if (index === startSeg && index === endSeg) {
      out += segment.text.slice(0, startOff) + replacement + segment.text.slice(endOff);
    } else if (index === startSeg) out += segment.text.slice(0, startOff) + replacement;
    else if (index === endSeg) out += segment.text.slice(endOff);
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

  throw new Error("This suggestion no longer matches the editor text.");
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
    throw new Error("This suggestion no longer matches the editor text.");
  }
  return { ...fields, [key]: next };
}
