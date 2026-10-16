import type { RuleEvaluationResult, TranslationQualityRule } from "@/lib/translation-quality/rules/types";
import type {
  BoilerplatePhrase,
  QualityTargetField,
  TranslationQualityInput,
} from "@/lib/translation-quality/types";
import {
  clampScore,
  languageCompatible,
  nearestStretch,
  normalizeSpace,
} from "@/lib/translation-quality/text";

const MODIFIED_AT = 0.8;

function translatedFields(input: TranslationQualityInput): { field: QualityTargetField; raw: string }[] {
  return [
    { field: "content" as const, raw: input.translatedContent || "" },
    { field: "summary" as const, raw: input.translatedSummary || "" },
    { field: "title" as const, raw: input.translatedTitle || "" },
  ].filter((item) => item.raw.trim());
}

/** The stretch of translated text closest to the approved passage, in any field. */
function closestPassage(
  input: TranslationQualityInput,
  expected: string
): { field: QualityTargetField; raw: string; text: string; score: number } | null {
  let best: { field: QualityTargetField; raw: string; text: string; score: number } | null = null;
  for (const { field, raw } of translatedFields(input)) {
    const near = nearestStretch(raw, expected);
    if (near && (!best || near.score > best.score)) best = { field, raw, ...near };
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
  readonly name = "Standard text";

  async evaluate(input: TranslationQualityInput): Promise<RuleEvaluationResult> {
    const all = input.boilerplate ?? [];
    const targetPhrases = phrasesFor(all, input.targetLanguage);
    if (targetPhrases.length === 0) {
      return {
        categoryCode: this.code,
        score: 100,
        summary: "No standard text is set up for this language.",
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
      // A missing passage goes into the field it sits in on the source: title, description, or body.
      const sourceField: QualityTargetField = sourcePhrase
        ? (
            [
              ["summary", input.sourceSummary],
              ["title", input.sourceTitle],
              ["content", input.sourceContent],
            ] as const
          ).find(([, text]) => normalizeSpace(text ?? "").includes(normalizeSpace(sourcePhrase.phrase)))?.[0] ??
          "content"
        : "content";
      const html = sourceField === "content" && /<[a-z][\s\S]*>/i.test(targetRaw || input.sourceContent || "");
      const proposed = html ? `<p>${escapeHtml(phrase.phrase)}</p>` : phrase.phrase;
      // Accept swaps the changed wording in place, in whichever field holds it.
      const original = modified ? closest.text : undefined;
      const canReplace = Boolean(original && closest?.raw.includes(original));

      findings.push({
        severity: modified ? "warning" : "error",
        title: modified ? "Standard text changed" : "Standard text missing",
        explanation: modified
          ? `"${phrase.name}" was changed. Restore the approved wording.`
          : `"${phrase.name}" is missing from the translation. Add the approved wording: ${phrase.phrase}`,
        sourceText: sourcePhrase?.phrase,
        translatedText: canReplace ? original : undefined,
        suggestedText: canReplace ? phrase.phrase : proposed,
        targetField: canReplace && closest ? closest.field : sourceField,
        actionType: canReplace ? "replace" : "insert",
      });
    }

    if (applicable === 0) {
      return {
        categoryCode: this.code,
        score: 100,
        summary: "No standard text is needed for this article.",
        findings: [],
      };
    }

    return {
      categoryCode: this.code,
      score: clampScore(100 - penalty),
      summary:
        findings.length === 0
          ? "Standard text is present and unchanged."
          : "Standard text is missing or changed.",
      findings,
    };
  }
}
