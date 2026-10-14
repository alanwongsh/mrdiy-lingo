import type { RuleEvaluationResult, TranslationQualityRule } from "@/lib/translation-quality/rules/types";
import type {
  BoilerplatePhrase,
  QualityTargetField,
  TranslationQualityInput,
} from "@/lib/translation-quality/types";
import {
  clampScore,
  languageCompatible,
  normalizeSpace,
  paragraphs,
  similarity,
} from "@/lib/translation-quality/text";

const MODIFIED_AT = 0.8;

type Passage = { field: QualityTargetField; raw: string; text: string; score: number };

function translatedFields(input: TranslationQualityInput): { field: QualityTargetField; raw: string }[] {
  return [
    { field: "content" as const, raw: input.translatedContent || "" },
    { field: "summary" as const, raw: input.translatedSummary || "" },
    { field: "title" as const, raw: input.translatedTitle || "" },
  ].filter((item) => item.raw.trim());
}

/**
 * The stretch of translated text closest to the approved passage, in any field. A paragraph can
 * hold the passage next to other sentences, so runs of about the passage's word count are compared,
 * not only whole paragraphs. Paragraphs sharing few words with the passage are skipped.
 */
function closestPassage(input: TranslationQualityInput, expected: string): Passage | null {
  const expectedWords = expected.split(" ").length;
  const expectedSet = new Set(expected.split(" "));
  let best: Passage | null = null;
  const consider = (field: QualityTargetField, raw: string, text: string) => {
    const score = similarity(normalizeSpace(text), expected);
    if (!best || score > best.score) best = { field, raw, text, score };
  };

  for (const { field, raw } of translatedFields(input)) {
    for (const paragraph of paragraphs(raw)) {
      consider(field, raw, paragraph);
      const words = [...paragraph.matchAll(/\S+/g)];
      const shared = words.filter((w) => expectedSet.has(w[0].toLowerCase())).length;
      if (words.length <= expectedWords || shared < expectedSet.size * 0.4) continue;
      for (let size = Math.max(1, expectedWords - 3); size <= expectedWords + 3; size += 1) {
        for (let start = 0; start + size <= words.length; start += 1) {
          const first = words[start];
          const last = words[start + size - 1];
          const from = first.index ?? 0;
          consider(field, raw, paragraph.slice(from, (last.index ?? 0) + last[0].length));
        }
      }
    }
  }
  return best;
}

function phrasesFor(
  phrases: BoilerplatePhrase[],
  language: string
): BoilerplatePhrase[] {
  const active = phrases.filter((phrase) => phrase.isActive);
  const exact = active.filter(
    (phrase) => phrase.language.trim().toLowerCase() === language.trim().toLowerCase()
  );
  if (exact.length > 0) return exact;
  return active.filter((phrase) => languageCompatible(phrase.language, language));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class BoilerplateRule implements TranslationQualityRule {
  readonly id = "boilerplate";
  readonly code = "boilerplate";
  readonly name = "Boilerplate";

  async evaluate(input: TranslationQualityInput): Promise<RuleEvaluationResult> {
    const all = input.boilerplate ?? [];
    const targetPhrases = phrasesFor(all, input.targetLanguage);
    if (targetPhrases.length === 0) {
      return {
        categoryCode: this.code,
        score: 100,
        summary: "No boilerplate is configured for this language.",
        findings: [],
      };
    }

    const sourceNorm = normalizeSpace(
      [input.sourceTitle, input.sourceSummary, input.sourceContent].filter(Boolean).join("\n")
    );
    const targetRaw = input.translatedContent || "";
    const targetNorm = normalizeSpace(
      [input.translatedTitle, input.translatedSummary, input.translatedContent]
        .filter(Boolean)
        .join("\n")
    );
    const findings: RuleEvaluationResult["findings"] = [];
    let applicable = 0;
    let penalty = 0;

    for (const phrase of targetPhrases) {
      const expected = normalizeSpace(phrase.phrase);
      if (!expected) continue;
      const sourcePhrase = all.find(
        (item) =>
          item.isActive &&
          item.name.trim().toLowerCase() === phrase.name.trim().toLowerCase() &&
          languageCompatible(item.language, input.sourceLanguage)
      );
      const sourceUsesIt = sourcePhrase
        ? sourceNorm.includes(normalizeSpace(sourcePhrase.phrase))
        : phrase.expectedUsage === "always";
      if (!sourceUsesIt && phrase.expectedUsage !== "always") continue;
      applicable += 1;

      if (targetNorm.includes(expected)) continue;

      const closest = closestPassage(input, expected);
      const modified = !!closest && closest.score >= MODIFIED_AT;
      penalty += modified ? 25 : 50;
      const html = /<[a-z][\s\S]*>/i.test(targetRaw);
      const proposed = html ? `<p>${escapeHtml(phrase.phrase)}</p>` : phrase.phrase;
      // Accept swaps the changed wording in place, in whichever field holds it.
      const original = modified ? closest.text : undefined;
      const canReplace = Boolean(original && closest?.raw.includes(original));

      findings.push({
        severity: modified ? "warning" : "error",
        title: modified ? "Modified boilerplate" : "Missing boilerplate",
        explanation: modified
          ? `"${phrase.name}" was changed. Restore the approved wording.`
          : `"${phrase.name}" is missing from the translation. Add the approved wording: ${phrase.phrase}`,
        sourceText: sourcePhrase?.phrase,
        translatedText: canReplace ? original : undefined,
        suggestedText: canReplace ? phrase.phrase : proposed,
        targetField: canReplace && closest ? closest.field : "content",
        actionType: canReplace ? "replace" : "insert",
      });
    }

    if (applicable === 0) {
      return {
        categoryCode: this.code,
        score: 100,
        summary: "No boilerplate is required for this article.",
        findings: [],
      };
    }

    return {
      categoryCode: this.code,
      score: clampScore(100 - penalty),
      summary:
        findings.length === 0
          ? "Required boilerplate is present."
          : "Boilerplate is missing or modified.",
      findings,
    };
  }
}
