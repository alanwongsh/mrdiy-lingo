import { randomUUID } from "crypto";
import type { ProviderQualityResult } from "@/lib/translation-quality/providers/provider";
import type { RuleEvaluationResult } from "@/lib/translation-quality/rules/types";
import { overallScore, severityForScore } from "@/lib/translation-quality/scoring/ScoreCalculator";
import type {
  QualityAction,
  QualityCategoryConfig,
  QualityFinding,
  QualityScore,
  QualityTargetField,
} from "@/lib/translation-quality/types";

const FIELD_TEXT: Record<
  QualityTargetField,
  "translatedTitle" | "translatedSummary" | "translatedContent"
> = {
  title: "translatedTitle",
  summary: "translatedSummary",
  content: "translatedContent",
};

export interface TranslatedFields {
  translatedTitle: string;
  translatedSummary: string;
  translatedContent: string;
}

interface DraftPiece {
  scores: QualityScore[];
  findings: QualityFinding[];
  actions: QualityAction[];
}

function fieldValue(fields: TranslatedFields, field: QualityTargetField): string {
  return fields[FIELD_TEXT[field]] ?? "";
}

function uniqueFields(fields: QualityTargetField[]): QualityTargetField[] {
  const seen = new Set<QualityTargetField>();
  const result: QualityTargetField[] = [];
  for (const field of fields) {
    if (seen.has(field)) continue;
    seen.add(field);
    result.push(field);
  }
  return result;
}

function locateQuote(
  fields: TranslatedFields,
  quote: string | undefined,
  preferred?: QualityTargetField
): { field: QualityTargetField; index: number } | null {
  if (!quote) return null;
  const order = uniqueFields(
    preferred
      ? [preferred, "content", "title", "summary"]
      : ["content", "title", "summary"]
  );
  for (const field of order) {
    const index = fieldValue(fields, field).indexOf(quote);
    if (index >= 0) return { field, index };
  }
  return null;
}

function offsetsFor(
  fields: TranslatedFields,
  field: QualityTargetField,
  quote: string | undefined,
  start?: number,
  end?: number
): { startOffset?: number; endOffset?: number } {
  if (!quote) return {};
  const text = fieldValue(fields, field);
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    start >= 0 &&
    end > start &&
    end <= text.length &&
    text.slice(start, end) === quote
  ) {
    return { startOffset: start, endOffset: end };
  }
  const index = text.indexOf(quote);
  if (index < 0) return {};
  return { startOffset: index, endOffset: index + quote.length };
}

function categoryScore(
  category: QualityCategoryConfig,
  score: number | null,
  summary: string,
  error?: string
): QualityScore {
  return {
    categoryCode: category.code,
    categoryName: category.name,
    categoryType: category.categoryType,
    score,
    severity: typeof score === "number" ? severityForScore(score) : undefined,
    summary,
    error,
    sortOrder: category.sortOrder,
  };
}

export function normalizeGeminiResult(
  raw: ProviderQualityResult,
  categories: QualityCategoryConfig[],
  fields: TranslatedFields
): DraftPiece {
  const ai = categories.filter((category) => category.categoryType === "ai");
  const byCode = new Map(raw.categories.map((category) => [category.categoryCode, category]));
  const scores: QualityScore[] = [];
  const findings: QualityFinding[] = [];
  const actions: QualityAction[] = [];

  for (const category of ai) {
    const returned = byCode.get(category.code);
    if (!returned) {
      scores.push(
        categoryScore(
          category,
          null,
          "The provider did not return this category.",
          "The provider did not return this category."
        )
      );
      continue;
    }
    scores.push(categoryScore(category, returned.score, returned.summary));
    for (const finding of returned.findings) {
      const id = randomUUID();
      const quote = finding.translatedText;
      const located = locateQuote(fields, quote, finding.targetField);
      const targetField = located?.field ?? finding.targetField;
      const range = offsetsFor(fields, targetField, quote);
      findings.push({
        id,
        categoryCode: category.code,
        severity: finding.severity,
        title: finding.title,
        explanation: finding.explanation,
        sourceText: finding.sourceText,
        translatedText: quote,
        suggestedText: finding.suggestedText,
        targetField,
        ...range,
      });
      const action = actionForFinding(
        id,
        finding.title,
        targetField,
        quote,
        finding.suggestedText,
        finding.actionType,
        fields,
        range
      );
      if (action) actions.push(action);
    }
  }

  return { scores, findings, actions };
}

export function normalizeRuleResults(
  results: RuleEvaluationResult[],
  categories: QualityCategoryConfig[],
  fields: TranslatedFields
): DraftPiece {
  const byCode = new Map(categories.map((category) => [category.code, category]));
  const scores: QualityScore[] = [];
  const findings: QualityFinding[] = [];
  const actions: QualityAction[] = [];

  for (const result of results) {
    const category = byCode.get(result.categoryCode);
    if (!category) continue;
    scores.push(
      categoryScore(category, result.score, result.summary, result.error)
    );
    for (const finding of result.findings) {
      const id = randomUUID();
      const targetField = finding.targetField ?? "content";
      const range = offsetsFor(
        fields,
        targetField,
        finding.translatedText,
        finding.startOffset,
        finding.endOffset
      );
      findings.push({
        id,
        categoryCode: category.code,
        severity: finding.severity,
        title: finding.title,
        explanation: finding.explanation,
        sourceText: finding.sourceText,
        translatedText: finding.translatedText,
        suggestedText: finding.suggestedText,
        targetField,
        ...range,
      });
      const action = actionForFinding(
        id,
        finding.title,
        targetField,
        finding.translatedText,
        finding.suggestedText,
        finding.actionType,
        fields,
        range
      );
      if (action) actions.push(action);
    }
  }

  return { scores, findings, actions };
}

function actionForFinding(
  findingId: string,
  title: string,
  targetField: QualityTargetField,
  original: string | undefined,
  proposed: string | undefined,
  actionType: QualityAction["actionType"] | undefined,
  fields: TranslatedFields,
  range: { startOffset?: number; endOffset?: number }
): QualityAction | null {
  const type = actionType ?? (original && proposed ? "replace" : undefined);
  if (!type) return null;
  const text = fieldValue(fields, targetField);
  if ((type === "replace" || type === "rewrite" || type === "delete") && original) {
    if (!text.includes(original)) return null;
    if ((type === "replace" || type === "rewrite") && (!proposed || proposed === original)) {
      return null;
    }
  } else if (type === "insert") {
    if (!proposed) return null;
  } else {
    return null;
  }

  return {
    id: randomUUID(),
    findingId,
    actionType: type,
    description: title,
    originalText: original,
    proposedText: proposed,
    targetField,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    status: "pending",
  };
}

export function combineQualityDraft(
  pieces: DraftPiece[],
  categories: QualityCategoryConfig[]
): DraftPiece & { overallScore: number | null } {
  const scores = pieces
    .flatMap((piece) => piece.scores)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    scores,
    findings: pieces.flatMap((piece) => piece.findings),
    actions: pieces.flatMap((piece) => piece.actions),
    overallScore: overallScore(scores, categories),
  };
}
