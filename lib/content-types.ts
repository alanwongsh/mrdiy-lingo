export const DEFAULT_CONTENT_TYPE_CODE = "GENERAL";

/** Stable code stored on articles and in import files. */
export function normalizeContentTypeCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^[^A-Z]+/, "")
    .replace(/_+$/g, "")
    .slice(0, 40);
}

export function contentTypeNameFromCode(code: string): string {
  const words = code.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return "General";
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ");
}
