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

/** The source of one field, so a body sentence is lined up with body sentences only. */
function sourceFieldText(input: TranslationQualityInput, field: QualityTargetField): string {
  if (field === "title") return input.sourceTitle ?? "";
  if (field === "summary") return input.sourceSummary ?? "";
  return input.sourceContent;
}

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

/** Letters and digits only, lower case: MR.D.I.Y, Mr DIY and MR.DIY all give "mrdiy". */
function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** A wrong spelling found in the translation, and what Accept puts in its place. */
type TermHit = {
  index: number;
  matched: string;
  suggested: string;
  /** The spelling is right; only a full stop is doubled, as in "Sdn. Bhd..". */
  doubledDot?: boolean;
};

/** Full stops written right after position `end`. */
function dotsAt(text: string, end: number): string {
  return text.slice(end).match(/^\.+/)?.[0] ?? "";
}

/** A spelling without its closing full stops: "Sdn. Bhd." gives "Sdn. Bhd". */
function withoutClosingDots(spelling: string): string {
  return spelling.replace(/\.+$/, "");
}

/**
 * A spelling that ends in a full stop (Sdn. Bhd., MR. D.I.Y.) shares it with the sentence,
 * as in normal writing. Before a full stop it drops its own, so a fix never writes "Bhd..".
 */
function fitToSentence(text: string, end: number, spelling: string): string {
  return spelling.endsWith(".") && dotsAt(text, end) ? withoutClosingDots(spelling) : spelling;
}

/**
 * A brand written with the right letters but other dots, spaces or case, such as MR.D.I.Y
 * or Mr. DIY for MR.DIY, so the avoid list need not name every variant. Web addresses
 * (mrdiy.com) and text inside tags or links are left alone.
 */
function brandVariantHits(text: string, preferred: string): TermHit[] {
  const key = nameKey(preferred);
  if (key.length < 3) return [];
  const core = withoutClosingDots(preferred);
  const closesWithDot = core !== preferred;
  const body = [...key].map((char) => escapeRegExp(char)).join("[\\s.\\-·'’]*");
  // Not inside a longer word or address; not followed by .com and the like.
  const re = new RegExp(`(?<![\\p{L}\\p{N}./@])${body}(?![\\p{L}\\p{N}])(?!\\.\\p{Ll}{2,})`, "giu");
  const hits: TermHit[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const matched = match[0];
    if (matched.length === 0) {
      re.lastIndex += 1;
      continue;
    }
    if (termHitContext(text, match.index, matched.length).hidden) continue;
    const end = match.index + matched.length;
    const dots = dotsAt(text, end);
    if (closesWithDot && matched === core) {
      // "MR. D.I.Y." mid-sentence or at the end is right; "MR. D.I.Y.." is one dot too many.
      if (dots.length === 1) continue;
      if (dots.length > 1) {
        hits.push({ index: match.index, matched: matched + dots, suggested: preferred, doubledDot: true });
        continue;
      }
    } else if (!closesWithDot && matched === preferred) {
      continue;
    }
    if (!dots) {
      hits.push({ index: match.index, matched, suggested: preferred });
      continue;
    }
    // Dots after a variant such as "MR D.I.Y." are its own when the sentence carries on in
    // lower case; otherwise the last one is the sentence's full stop and stays, exactly once.
    const continues = /^\s*(?:<[^>]+>\s*)*\p{Ll}/u.test(text.slice(end + dots.length));
    if (continues) {
      hits.push({ index: match.index, matched: matched + dots, suggested: preferred });
    } else {
      hits.push({
        index: match.index,
        matched: matched + dots.slice(1),
        suggested: closesWithDot ? core : preferred,
      });
    }
  }
  return hits;
}

/** Any glossary spelling that ends in a full stop, written with one more: "Sdn. Bhd..". */
function doubledDotHits(text: string, preferred: string): TermHit[] {
  if (!preferred.endsWith(".")) return [];
  return visibleTerm(text, preferred).flatMap((hit) => {
    const extra = dotsAt(text, hit.index + hit.matched.length);
    return extra
      ? [{ index: hit.index, matched: hit.matched + extra, suggested: preferred, doubledDot: true }]
      : [];
  });
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

/** Stands in for a dot inside a protected phrase while sentences are split. */
const KEPT_DOT = "․";

/**
 * Sentences of a text. Dots inside the given phrases (glossary spellings such as "Sdn. Bhd."
 * or "MR. D.I.Y.") do not end a sentence, so "Run by MR DIY Sdn. Bhd." stays one sentence.
 */
function sentencesOf(value: string, protect: string[] = []): string[] {
  let text = htmlToText(value);
  for (const phrase of protect) {
    if (!/\.\s/.test(phrase)) continue;
    text = text.replace(new RegExp(escapeRegExp(phrase), "gi"), (found) => found.replace(/\./g, KEPT_DOT));
  }
  return text
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((part) => part.split(KEPT_DOT).join(".").trim())
    .filter(Boolean);
}

function sentenceAt(html: string, index: number, length: number, protect: string[] = []): string {
  const matched = html.slice(index, index + length).trim().toLowerCase();
  const sentences = sentencesOf(html, protect);
  if (!matched) return "";
  const before = sentencesOf(html.slice(0, index), protect).length;
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
  readonly name = "Glossary";

  async evaluate(input: TranslationQualityInput): Promise<RuleEvaluationResult> {
    const entries = entriesForPair(input);
    if (entries.length === 0) {
      return {
        categoryCode: this.code,
        score: 100,
        summary: "No glossary words are set up for this language pair.",
        findings: [],
      };
    }

    const source = sourceText(input);
    // Collected per entry first: two entries (say MR.DIY and MR DIY Group) can point at the
    // same words, and that is one mistake, shown once and charged once.
    const candidates: Array<{
      finding: RuleEvaluationResult["findings"][number];
      term: string;
      cost: number;
    }> = [];


    for (const entry of entries) {
      const preferred = entry.preferredTranslation.trim();
      const forbidden = entry.forbiddenTranslations.map((item) => item.trim()).filter(Boolean);
      const inSource = sourceHasTerm(source, entry.term);
      const isBrand = entry.category.trim().toLowerCase() === "brand";
      const replacement = preferred || entry.term;
      const forbiddenHits = FIELDS.flatMap((field) => {
        const text = field.text(input);
        const found: TermHit[] = [
          // Brand variants first, so a "MR. D.I.Y.." keeps its own message when an avoid word also matches.
          ...(isBrand && preferred ? brandVariantHits(text, preferred) : []),
          ...(preferred ? doubledDotHits(text, preferred) : []),
          ...forbidden.flatMap((phrase) =>
            visibleTerm(text, phrase).map((hit) => ({
              ...hit,
              suggested: fitToSentence(text, hit.index + hit.matched.length, replacement),
            }))
          ),
        ];
        return found.map((hit) => ({ field: field.field, hit }));
      });
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
      // This entry's own spellings never split a sentence at their dots.
      const protectedPhrases = [entry.term, preferred, ...forbidden].filter(Boolean);
      const applicableForbiddenHits = brand
        ? uniqueForbiddenHits
        : uniqueForbiddenHits.filter((hit) => {
            // A doubled full stop is wrong whatever the source sentence says.
            if (hit.hit.doubledDot) return true;
            const translatedSentences = sentencesOf(
              FIELDS.find((field) => field.field === hit.field)?.text(input) ?? "",
              protectedPhrases
            );
            const translatedSentence = sentenceAt(
              FIELDS.find((field) => field.field === hit.field)?.text(input) ?? "",
              hit.hit.index,
              hit.hit.matched.length,
              protectedPhrases
            );
            const sourceSentence = sourceSentenceForTerm(
              translatedSentence,
              translatedSentences,
              sentencesOf(sourceFieldText(input, hit.field), protectedPhrases)
            );
            return sourceHasTerm(sourceSentence, entry.term);
          });
      if (applicableForbiddenHits.length > 0) {
        const inconsistent = preferredHits.length > 0;
        for (const hit of applicableForbiddenHits.slice(0, 8)) {
          candidates.push({
            term: entry.term,
            cost: 11,
            finding: {
              severity: "warning",
              title: hit.hit.doubledDot
                ? "Double full stop"
                : brand
                  ? "Brand name not as in glossary"
                  : inconsistent
                    ? "Glossary word used inconsistently"
                    : "Word not as in glossary",
              explanation: hit.hit.doubledDot
                ? `"${replacement}" already ends with a full stop, so the sentence needs no second one.`
                : brand
                  ? `The brand name should remain ${replacement}.`
                  : inconsistent
                    ? `Use "${preferred}" for ${entry.term}. "${hit.hit.matched}" is not the preferred translation.`
                    : `"${hit.hit.matched}" is not the preferred translation for ${entry.term}. Use "${replacement}".`,
              sourceText: entry.term,
              translatedText: hit.hit.matched,
              suggestedText: hit.hit.suggested,
              targetField: hit.field,
              startOffset: hit.hit.index,
              endOffset: hit.hit.index + hit.hit.matched.length,
                actionType: "replace",
            },
          });
        }
      } else if (inSource && preferred && preferredHits.length === 0) {
        const replacements = FIELDS.flatMap((field) => {
          const text = field.text(input);
          return visibleTerm(text, entry.term).map((hit) => ({
            field: field.field,
            hit: { ...hit, suggested: fitToSentence(text, hit.index + hit.matched.length, preferred) },
          }));
        });
        if (replacements.length === 0) continue;
        for (const hit of replacements.slice(0, 8)) {
          candidates.push({
            term: entry.term,
            cost: 8,
            finding: {
              severity: "warning",
              title: "Glossary word missing",
              explanation: `The source uses "${entry.term}". Replace "${hit.hit.matched}" with "${preferred}".`,
              sourceText: entry.term,
              translatedText: hit.hit.matched,
              suggestedText: hit.hit.suggested,
              targetField: hit.field,
              startOffset: hit.hit.index,
              endOffset: hit.hit.index + hit.hit.matched.length,
                actionType: "replace",
            },
          });
        }
      }
    }

    const kept: typeof candidates = [];
    for (const candidate of candidates) {
      const { targetField, startOffset = 0, endOffset = 0 } = candidate.finding;
      const overlaps = kept.some(
        (other) =>
          other.finding.targetField === targetField &&
          (other.finding.startOffset ?? 0) < endOffset &&
          startOffset < (other.finding.endOffset ?? 0)
      );
      if (!overlaps) kept.push(candidate);
    }
    const findings = kept.map((candidate) => candidate.finding);
    const costs = new Map<string, number>();
    for (const candidate of kept) {
      costs.set(candidate.term, Math.max(costs.get(candidate.term) ?? 0, candidate.cost));
    }
    const issueNames = [...costs.keys()];
    const penalty = [...costs.values()].reduce((sum, cost) => sum + cost, 0);
    const score = clampScore(100 - penalty);
    const summary =
      issueNames.length === 0
        ? "Glossary words are used consistently."
        : `${issueNames.length} ${issueNames.length === 1 ? "term needs" : "terms need"} attention: ${issueNames.join(", ")}. Each term with a forbidden spelling costs 11 points.`;

    return { categoryCode: this.code, score, summary, findings };
  }
}
