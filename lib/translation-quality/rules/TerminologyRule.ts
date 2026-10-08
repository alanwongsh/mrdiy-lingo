import type { RuleEvaluationResult, TranslationQualityRule } from "@/lib/translation-quality/rules/types";
import type {
  QualityTargetField,
  TerminologyEntry,
  TranslationQualityInput,
} from "@/lib/translation-quality/types";
import {
  clampScore,
  findTerm,
  htmlToText,
  languageCompatible,
  termHitContext,
} from "@/lib/translation-quality/text";

const FIELDS: Array<{ field: QualityTargetField; text: (input: TranslationQualityInput) => string }> = [
  { field: "title", text: (input) => input.translatedTitle ?? "" },
  { field: "summary", text: (input) => input.translatedSummary ?? "" },
  { field: "content", text: (input) => input.translatedContent },
];

function sourceText(input: TranslationQualityInput): string {
  return [input.sourceTitle, input.sourceSummary, input.sourceContent]
    .map((value) => htmlToText(value ?? ""))
    .filter(Boolean)
    .join("\n");
}

function visibleTerm(text: string, phrase: string) {
  return findTerm(text, phrase).filter(
    (hit) => !termHitContext(text, hit.index, hit.matched.length).hidden
  );
}

function sourceHasTerm(source: string, term: string): boolean {
  if (findTerm(source, term).length > 0) return true;
  if (/^[A-Za-z]+$/.test(term) && findTerm(source, `${term}s`).length > 0) return true;
  return false;
}

function entriesForPair(input: TranslationQualityInput): TerminologyEntry[] {
  const rows = (input.terminology ?? []).filter((entry) => entry.isActive);
  const exact = rows.filter(
    (entry) =>
      entry.sourceLanguage.trim().toLowerCase() === input.sourceLanguage.trim().toLowerCase() &&
      entry.targetLanguage.trim().toLowerCase() === input.targetLanguage.trim().toLowerCase()
  );
  if (exact.length > 0) return exact;
  return rows.filter(
    (entry) =>
      languageCompatible(entry.sourceLanguage, input.sourceLanguage) &&
      languageCompatible(entry.targetLanguage, input.targetLanguage)
  );
}

export class TerminologyRule implements TranslationQualityRule {
  readonly id = "terminology";
  readonly code = "terminology";
  readonly name = "Terminology";

  async evaluate(input: TranslationQualityInput): Promise<RuleEvaluationResult> {
    const entries = entriesForPair(input);
    if (entries.length === 0) {
      return {
        categoryCode: this.code,
        score: 100,
        summary: "No terminology is configured for this language pair.",
        findings: [],
      };
    }

    const source = sourceText(input);
    const findings: RuleEvaluationResult["findings"] = [];
    let penalty = 0;
    const issueNames: string[] = [];

    for (const entry of entries) {
      const preferred = entry.preferredTranslation.trim();
      const forbidden = entry.forbiddenTranslations.map((item) => item.trim()).filter(Boolean);
      const inSource = sourceHasTerm(source, entry.term);
      const forbiddenHits = FIELDS.flatMap((field) =>
        forbidden.flatMap((phrase) =>
          visibleTerm(field.text(input), phrase).map((hit) => ({
            field: field.field,
            hit,
            phrase,
          }))
        )
      );
      const seenHits = new Set<string>();
      const uniqueForbiddenHits = forbiddenHits.filter((hit) => {
        const key = `${hit.field}:${hit.hit.index}`;
        if (seenHits.has(key)) return false;
        seenHits.add(key);
        return true;
      });
      const preferredHits = preferred
        ? FIELDS.flatMap((field) => visibleTerm(field.text(input), preferred))
        : [];
      if (!inSource && forbiddenHits.length === 0 && preferredHits.length === 0) continue;

      if (uniqueForbiddenHits.length > 0) {
        penalty += 11;
        issueNames.push(entry.term);
        const inconsistent = preferredHits.length > 0;
        const brand = entry.category.trim().toLowerCase() === "brand";
        for (const hit of uniqueForbiddenHits.slice(0, 8)) {
          findings.push({
            severity: "warning",
            title: brand
              ? "Incorrect brand terminology"
              : inconsistent
                ? "Inconsistent terminology"
                : "Incorrect terminology",
            explanation: brand
              ? `The brand name should remain ${preferred || entry.term}.`
              : inconsistent
                ? `Use "${preferred}" for ${entry.term}. "${hit.hit.matched}" is not the preferred translation.`
                : `"${hit.hit.matched}" is not the preferred translation for ${entry.term}. Use "${preferred || entry.term}".`,
            sourceText: entry.term,
            translatedText: hit.hit.matched,
            suggestedText: preferred || entry.term,
            targetField: hit.field,
            startOffset: hit.hit.index,
            endOffset: hit.hit.index + hit.hit.matched.length,
            actionType: "replace",
          });
        }
      } else if (inSource && preferred && preferredHits.length === 0) {
        penalty += 8;
        issueNames.push(entry.term);
        findings.push({
          severity: "warning",
          title: "Missing preferred terminology",
          explanation: `The source uses "${entry.term}", but the translation does not use "${preferred}".`,
          sourceText: entry.term,
          suggestedText: preferred,
          targetField: "content",
        });
      }
    }

    const score = clampScore(100 - penalty);
    const summary =
      issueNames.length === 0
        ? "Preferred terminology is used consistently."
        : `${issueNames.length} ${issueNames.length === 1 ? "term needs" : "terms need"} attention: ${issueNames.join(", ")}. Each term with a forbidden spelling costs 11 points.`;

    return { categoryCode: this.code, score, summary, findings };
  }
}
