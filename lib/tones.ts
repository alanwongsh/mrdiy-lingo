import { normalizeContentTypeCode } from "@/lib/content-types";
import { languageCompatible } from "@/lib/translation-quality/text";
import type { ContentTypeRecord, ToneProfile } from "@/lib/types";

/** What translation and review need to know about a tone. */
export type TonePrompt = {
  code: string;
  name: string;
  instructions: string;
  languageNotes: Record<string, string>;
  allowAdaptation: boolean;
};

/** Same code rules as article types: FORMAL, PRESS, SOCIAL_MEDIA. */
export const normalizeToneCode = normalizeContentTypeCode;

export function tonePrompt(tone: ToneProfile): TonePrompt {
  return {
    code: tone.code,
    name: tone.name,
    instructions: tone.instructions,
    languageNotes: tone.language_notes ?? {},
    allowAdaptation: tone.allow_adaptation,
  };
}

/** The article's own tone, else its type's default. Null when neither is set. */
export function effectiveToneCode(
  articleTone: string | null | undefined,
  contentType: Pick<ContentTypeRecord, "default_tone"> | null | undefined
): string | null {
  return articleTone?.trim() || contentType?.default_tone?.trim() || null;
}

/** Guidance for one language. An exact code wins over a compatible one such as zh for zh-Hans. */
export function toneLanguageNote(tone: TonePrompt, language: string): string {
  const entries = Object.entries(tone.languageNotes).filter(([, note]) => note.trim());
  const key = language.trim().toLowerCase();
  const exact = entries.find(([code]) => code.trim().toLowerCase() === key);
  const match = exact ?? entries.find(([code]) => languageCompatible(code, language));
  return match?.[1].trim() ?? "";
}

/** Prompt lines for a translation request. Empty without a tone. */
export function toneTranslationLines(
  tone: TonePrompt | null | undefined,
  targetLanguage: string
): string[] {
  if (!tone) return [];
  const note = toneLanguageNote(tone, targetLanguage);
  const lines = ["", `Write in the ${tone.name} tone.`];
  if (tone.instructions.trim()) lines.push(tone.instructions.trim());
  if (note) lines.push(`For ${targetLanguage}: ${note}`);
  lines.push(
    tone.allowAdaptation
      ? "You may reword, shorten, reorder sentences, and adapt idioms, emoji, and hashtags so it reads naturally for this audience. Keep the same message and every fact: prices, numbers, dates, names, brand marks, web addresses, and glossary terms stay exactly as given."
      : "Change only word choice and register to fit this tone. Keep the meaning, every fact, and the sentence structure of the source."
  );
  return lines;
}

/** Prompt lines for the quality review. Without a tone, tone is compared against the source. */
export function toneReviewLines(
  tone: TonePrompt | null | undefined,
  targetLanguage: string
): string[] {
  if (!tone) {
    return ["For tone, compare the translated tone against the source."];
  }
  const note = toneLanguageNote(tone, targetLanguage);
  const lines = [
    `The translation was asked to use the ${tone.name} tone. For tone, score how well it fits that tone, not how closely it copies the source tone.`,
  ];
  if (tone.instructions.trim()) lines.push(`${tone.name} tone: ${tone.instructions.trim()}`);
  if (note) lines.push(`For ${targetLanguage}: ${note}`);
  if (tone.allowAdaptation) {
    lines.push(
      "This tone allows adaptation. Rewording, shortening, reordering, and adapted idioms, emoji, or hashtags are intended. Do not lower cross_language or structure for them.",
      "Still report any changed or missing fact as cross_language: prices, numbers, dates, names, brand marks, web addresses, offers, and conditions must match the source."
    );
  }
  return lines;
}
