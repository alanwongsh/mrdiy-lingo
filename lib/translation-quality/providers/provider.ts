import type {
  FindingSeverity,
  QualityActionType,
  QualityTargetField,
  TranslationQualityInput,
} from "@/lib/translation-quality/types";

export interface ProviderFinding {
  severity: FindingSeverity;
  title: string;
  explanation: string;
  sourceText?: string;
  translatedText?: string;
  suggestedText?: string;
  targetField: QualityTargetField;
  actionType?: QualityActionType;
}

export interface ProviderCategoryResult {
  categoryCode: string;
  score: number;
  summary: string;
  findings: ProviderFinding[];
}

/** Provider-specific payload. Normalize this before it reaches the article UI. */
export interface ProviderQualityResult {
  providerId: string;
  model?: string;
  categories: ProviderCategoryResult[];
  usage?: {
    promptTokens?: number;
    outputTokens?: number;
  };
}

export interface TranslationQualityProvider {
  id: string;
  name: string;
  analyze(input: TranslationQualityInput): Promise<ProviderQualityResult>;
}
