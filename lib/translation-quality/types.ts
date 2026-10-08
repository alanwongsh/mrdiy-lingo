export type QualityCategoryType = "ai" | "rule";

export type ScoreSeverity = "excellent" | "good" | "warning" | "critical";

export type FindingSeverity = "info" | "warning" | "error" | "critical";

export type QualityActionType = "replace" | "insert" | "delete" | "rewrite";

export type QualityTargetField = "title" | "summary" | "content";

export type QualityActionStatus = "pending" | "applied" | "ignored";

export type QualityRunStatus = "pending" | "running" | "completed" | "failed";

export interface QualityCategoryConfig {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryType: QualityCategoryType;
  enabled: boolean;
  sortOrder: number;
  /** Null uses the configured quality provider. Rules leave this empty. */
  provider: string | null;
  /** Relative weight used for the overall score. */
  weight: number;
}

export interface TerminologyEntry {
  id: string;
  term: string;
  definition: string;
  description: string;
  sourceLanguage: string;
  targetLanguage: string;
  preferredTranslation: string;
  forbiddenTranslations: string[];
  category: string;
  context: string;
  example: string;
  isActive: boolean;
}

export interface BoilerplatePhrase {
  id: string;
  name: string;
  language: string;
  phrase: string;
  expectedUsage: string;
  isActive: boolean;
}

export interface TranslationQualityInput {
  sourceLanguage: string;
  targetLanguage: string;
  sourceTitle?: string;
  sourceSummary?: string;
  sourceContent: string;
  translatedTitle?: string;
  translatedSummary?: string;
  translatedContent: string;
  terminology?: TerminologyEntry[];
  boilerplate?: BoilerplatePhrase[];
  enabledCategories: QualityCategoryConfig[];
}

export interface QualityScore {
  categoryCode: string;
  categoryName: string;
  categoryType: QualityCategoryType;
  /** Null when that category failed and the rest of the analysis continued. */
  score: number | null;
  severity?: ScoreSeverity;
  summary?: string;
  error?: string;
  sortOrder: number;
}

export interface QualityFinding {
  id: string;
  categoryCode: string;
  severity: FindingSeverity;
  title: string;
  explanation: string;
  sourceText?: string;
  translatedText?: string;
  suggestedText?: string;
  targetField?: QualityTargetField;
  startOffset?: number;
  endOffset?: number;
}

export interface QualityAction {
  id: string;
  findingId: string;
  actionType: QualityActionType;
  description: string;
  originalText?: string;
  proposedText?: string;
  targetField: QualityTargetField;
  startOffset?: number;
  endOffset?: number;
  status: QualityActionStatus;
}

export interface TranslationQualityResult {
  runId: string;
  status: QualityRunStatus;
  overallScore: number | null;
  scores: QualityScore[];
  findings: QualityFinding[];
  actions: QualityAction[];
  metadata: {
    provider: string;
    model?: string;
    promptVersion?: string;
    durationMs?: number;
    partial?: boolean;
    categoryErrors?: { categoryCode: string; message: string }[];
  };
  createdAt: string;
  completedAt?: string;
  /** False for a check of unsaved text. Those results are not kept. */
  persisted: boolean;
}

export interface QualityRunSummary {
  id: string;
  provider: string;
  model?: string;
  status: QualityRunStatus;
  overallScore: number | null;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: string;
  completedAt?: string;
  versionId?: string;
}

export interface TranslationQualityBundle {
  categories: QualityCategoryConfig[];
  runs: QualityRunSummary[];
  /** Analysis for the latest saved version, when that version has one. */
  latest: TranslationQualityResult | null;
  versionId: string | null;
  versionNumber: number | null;
  /** False once this saved version has been analyzed. */
  canAnalyze: boolean;
}
