export function normalizeTargetLanguages(
  codes: string[] | null | undefined,
  sourceLanguage: string
): string[] {
  const source = sourceLanguage.trim().toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of codes ?? []) {
    const code = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!code || code === source || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}
