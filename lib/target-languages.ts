export function languageKey(code: string) {
  return code.trim().toLowerCase();
}

/** Keep catalog spelling (`zh-Hans`) when a saved code differs only by case. */
export function normalizeTargetLanguages(
  codes: string[] | null | undefined,
  sourceLanguage: string,
  catalog?: readonly string[]
): string[] {
  const source = languageKey(sourceLanguage);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of codes ?? []) {
    const trimmed = String(raw ?? "").trim();
    const key = languageKey(trimmed);
    if (!key || key === source || seen.has(key)) continue;
    seen.add(key);
    const canonical = catalog?.find((code) => languageKey(code) === key);
    result.push(canonical?.trim() || trimmed);
  }
  return result;
}
