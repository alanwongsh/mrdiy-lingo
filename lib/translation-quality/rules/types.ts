import type {
  FindingSeverity,
  QualityActionType,
  QualityTargetField,
  TranslationQualityInput,
} from "@/lib/translation-quality/types";

export interface RuleFindingDraft {
  severity: FindingSeverity;
  title: string;
  explanation: string;
  sourceText?: string;
  translatedText?: string;
  suggestedText?: string;
  targetField?: QualityTargetField;
  startOffset?: number;
  endOffset?: number;
  actionType?: QualityActionType;
}

export interface RuleEvaluationResult {
  categoryCode: string;
  score: number | null;
  summary: string;
  error?: string;
  findings: RuleFindingDraft[];
}

export interface TranslationQualityRule {
  id: string;
  code: string;
  name: string;
  evaluate(input: TranslationQualityInput): Promise<RuleEvaluationResult>;
}
