import type { QualityAction, QualityTargetField } from "@/lib/translation-quality/types";
import type { SourceContentFields } from "@/lib/types";

function fieldKey(field: QualityTargetField): keyof SourceContentFields {
  if (field === "content") return "body";
  return field;
}

function applyToText(current: string, action: QualityAction): string {
  const original = action.originalText ?? "";
  const proposed = action.proposedText ?? "";

  if (
    (action.actionType === "replace" || action.actionType === "rewrite") &&
    original
  ) {
    const index = current.indexOf(original);
    if (index >= 0) {
      return (
        current.slice(0, index) +
        proposed +
        current.slice(index + original.length)
      );
    }
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
