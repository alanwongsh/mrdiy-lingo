import { findTerm, htmlToText, languageCompatible, normalizeSpace } from "@/lib/translation-quality/text";
import type { BoilerplatePhrase, TerminologyEntry } from "@/lib/translation-quality/types";

function sameLanguage(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** Entries for this language pair. An exact pair wins over a compatible one such as zh for zh-Hans. */
function entriesForPair(entries: TerminologyEntry[], sourceLanguage: string, targetLanguage: string) {
  const active = entries.filter((entry) => entry.isActive);
  const exact = active.filter(
    (entry) =>
      sameLanguage(entry.sourceLanguage, sourceLanguage) &&
      sameLanguage(entry.targetLanguage, targetLanguage)
  );
  if (exact.length > 0) return exact;
  return active.filter(
    (entry) =>
      languageCompatible(entry.sourceLanguage, sourceLanguage) &&
      languageCompatible(entry.targetLanguage, targetLanguage)
  );
}

function sourceUsesTerm(plain: string, term: string) {
  if (findTerm(plain, term).length > 0) return true;
  return /^[A-Za-z]+$/.test(term.trim()) && findTerm(plain, `${term.trim()}s`).length > 0;
}

/**
 * Glossary lines for a prompt. With `sourceText`, only terms that appear in it are listed,
 * so a short string does not carry the whole glossary.
 */
export function glossaryLines(
  entries: TerminologyEntry[] | undefined,
  sourceLanguage: string,
  targetLanguage: string,
  sourceText?: string
): string[] {
  const plain = sourceText === undefined ? "" : htmlToText(sourceText);
  return entriesForPair(entries ?? [], sourceLanguage, targetLanguage)
    .filter((entry) => sourceText === undefined || sourceUsesTerm(plain, entry.term))
    .map((entry) => {
      const preferred = entry.preferredTranslation.trim() || entry.term;
      const forbidden = entry.forbiddenTranslations.map((item) => item.trim()).filter(Boolean);
      const avoid = forbidden.length > 0 ? `; do not use ${forbidden.join(", ")} for this term` : "";
      return `- When the source says "${entry.term}", use "${preferred}"${avoid}.`;
    });
}

/** Approved wording for boilerplate the source contains, matched by phrase name across languages. */
export function boilerplateLines(
  phrases: BoilerplatePhrase[] | undefined,
  sourceLanguage: string,
  targetLanguage: string,
  sourceText: string
): string[] {
  const active = (phrases ?? []).filter((phrase) => phrase.isActive);
  const source = normalizeSpace(sourceText);
  if (!source) return [];
  const forLanguage = (language: string) => {
    const exact = active.filter((phrase) => sameLanguage(phrase.language, language));
    return exact.length > 0
      ? exact
      : active.filter((phrase) => languageCompatible(phrase.language, language));
  };
  const sourcePhrases = forLanguage(sourceLanguage);
  return forLanguage(targetLanguage).flatMap((target) => {
    const name = target.name.trim().toLowerCase();
    const original = sourcePhrases.find((phrase) => phrase.name.trim().toLowerCase() === name);
    if (!original || !source.includes(normalizeSpace(original.phrase))) return [];
    return [`- Translate "${htmlToText(original.phrase)}" exactly as "${htmlToText(target.phrase)}".`];
  });
}

/** Prompt section for a translation request. Empty when nothing applies. */
export function glossaryPrompt(input: {
  terminology?: TerminologyEntry[];
  boilerplate?: BoilerplatePhrase[];
  sourceLanguage: string;
  targetLanguage: string;
  sourceText: string;
}): string[] {
  const terms = glossaryLines(input.terminology, input.sourceLanguage, input.targetLanguage, input.sourceText);
  const fixed = boilerplateLines(input.boilerplate, input.sourceLanguage, input.targetLanguage, input.sourceText);
  const lines: string[] = [];
  if (terms.length > 0) {
    lines.push(
      "",
      "Use this glossary. A preferred word applies only where the source uses that term.",
      ...terms
    );
  }
  if (fixed.length > 0) {
    lines.push("", "Use the approved wording for these standard passages.", ...fixed);
  }
  return lines;
}
