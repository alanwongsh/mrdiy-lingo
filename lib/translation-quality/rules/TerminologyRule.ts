import type { RuleEvaluationResult, TranslationQualityRule } from "@/lib/translation-quality/rules/types";
import type {
  QualityTargetField,
  TerminologyEntry,
  TranslationQualityInput,
} from "@/lib/translation-quality/types";
import {
  clampScore,
  escapeRegExp,
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

function termPlain(value: string): string {
  return htmlToText(value)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
}

/** A multi-word name still counts when tags or line breaks leave the words touching. */
function containsTerm(text: string, term: string): boolean {
  const plain = termPlain(text);
  if (findTerm(plain, term).length > 0) return true;
  const parts = term.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const pattern = parts.map((part) => escapeRegExp(part)).join("\\s*");
  return new RegExp(`(?:^|[^A-Za-z0-9])${pattern}(?=$|[^A-Za-z0-9])`, "i").test(plain);
}

/** MR.DIYrangkaian still contains the brand MR.DIY. */
function leadingBrandPresent(text: string, term: string): boolean {
  const head = term.trim().split(/\s+/)[0] ?? "";
  if (head.length < 3) return false;
  return new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(head)}`, "i").test(termPlain(text));
}

function hasPreferred(text: string, entry: TerminologyEntry, preferred: string): boolean {
  if (containsTerm(text, preferred)) return true;
  const keepAsWritten = preferred.toLowerCase() === entry.term.trim().toLowerCase();
  const brand = entry.category.trim().toLowerCase() === "brand";
  return keepAsWritten && brand && leadingBrandPresent(text, preferred);
}

function sourceHasTerm(source: string, term: string): boolean {
  if (containsTerm(source, term)) return true;
  if (/^[A-Za-z]+$/.test(term) && findTerm(termPlain(source), `${term}s`).length > 0) return true;
  return false;
}

function sentencesOf(value: string): string[] {
  return htmlToText(value)
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sentenceAt(html: string, index: number, length: number): string {
  const matched = html.slice(index, index + length).trim().toLowerCase();
  const sentences = sentencesOf(html);
  if (!matched) return "";
  const before = sentencesOf(html.slice(0, index)).length;
  const around = sentences[Math.max(0, before - 1)] ?? "";
  if (around.toLowerCase().includes(matched)) return around;
  return sentences.find((sentence) => sentence.toLowerCase().includes(matched)) ?? around;
}

/** "gerai" is wrong for Store only in the sentence that says store, not for booths. */
function sourceSentenceForTerm(
  translatedSentence: string,
  translatedSentences: string[],
  sourceSentences: string[]
): string {
  const numbers = translatedSentence.match(/\d[\d,.]*/g) ?? [];
  let best = "";
  let bestScore = 0;
  for (const source of sourceSentences) {
    let score = 0;
    for (const number of numbers) {
      if (number.replace(/\D/g, "").length >= 2 && source.includes(number)) score += 5;
    }
    if (score > bestScore) {
      bestScore = score;
      best = source;
    }
  }
  if (best) return best;
  if (sourceSentences.length === translatedSentences.length) {
    const index = translatedSentences.indexOf(translatedSentence);
    if (index >= 0) return sourceSentences[index] ?? "";
  }
  return "";
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
        ? FIELDS.filter((field) => hasPreferred(field.text(input), entry, preferred))
        : [];
      if (!inSource && forbiddenHits.length === 0 && preferredHits.length === 0) continue;

      const brand = entry.category.trim().toLowerCase() === "brand";
      const applicableForbiddenHits = brand
        ? uniqueForbiddenHits
        : uniqueForbiddenHits.filter((hit) => {
            const translatedSentences = sentencesOf(FIELDS.find((field) => field.field === hit.field)?.text(input) ?? "");
            const translatedSentence = sentenceAt(
              FIELDS.find((field) => field.field === hit.field)?.text(input) ?? "",
              hit.hit.index,
              hit.hit.matched.length
            );
            const sourceSentence = sourceSentenceForTerm(
              translatedSentence,
              translatedSentences,
              sentencesOf(source)
            );
            return sourceHasTerm(sourceSentence, entry.term);
          });
      if (applicableForbiddenHits.length > 0) {
        penalty += 11;
        issueNames.push(entry.term);
        const inconsistent = preferredHits.length > 0;
        for (const hit of applicableForbiddenHits.slice(0, 8)) {
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
        const replacements = FIELDS.flatMap((field) =>
          visibleTerm(field.text(input), entry.term).map((hit) => ({
            field: field.field,
            hit,
          }))
        );
        if (replacements.length === 0) continue;
        penalty += 8;
        issueNames.push(entry.term);
        for (const hit of replacements.slice(0, 8)) {
          findings.push({
            severity: "warning",
            title: "Missing preferred terminology",
            explanation: `The source uses "${entry.term}". Replace "${hit.hit.matched}" with "${preferred}".`,
            sourceText: entry.term,
            translatedText: hit.hit.matched,
            suggestedText: preferred,
            targetField: hit.field,
            startOffset: hit.hit.index,
            endOffset: hit.hit.index + hit.hit.matched.length,
            actionType: "replace",
          });
        }
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
