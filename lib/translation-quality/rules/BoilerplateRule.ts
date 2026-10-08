import type { RuleEvaluationResult, TranslationQualityRule } from "@/lib/translation-quality/rules/types";
import type { BoilerplatePhrase, TranslationQualityInput } from "@/lib/translation-quality/types";
import {
  clampScore,
  languageCompatible,
  normalizeSpace,
  paragraphs,
  similarity,
} from "@/lib/translation-quality/text";

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
    const targetParagraphs = paragraphs(targetRaw);
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

      const closest = targetParagraphs
        .map((paragraph) => ({
          paragraph,
          score: similarity(normalizeSpace(paragraph), expected),
        }))
        .sort((a, b) => b.score - a.score)[0];
      const modified = closest && closest.score >= 0.8;
      penalty += modified ? 25 : 50;
      const html = /<[a-z][\s\S]*>/i.test(targetRaw);
      const proposed = html ? `<p>${escapeHtml(phrase.phrase)}</p>` : phrase.phrase;
      const original = modified ? closest?.paragraph : undefined;
      const canReplace = Boolean(original && targetRaw.includes(original));

      findings.push({
        severity: modified ? "warning" : "error",
        title: modified ? "Modified boilerplate" : "Missing boilerplate",
        explanation: modified
          ? `"${phrase.name}" was changed. Restore the approved wording.`
          : `"${phrase.name}" is missing from the translation.`,
        sourceText: sourcePhrase?.phrase,
        translatedText: canReplace ? original : undefined,
        suggestedText: canReplace ? phrase.phrase : proposed,
        targetField: "content",
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
