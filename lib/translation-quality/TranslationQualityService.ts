import { randomUUID } from "node:crypto";
import { qualityConfig } from "@/lib/translation-quality/config";
import {
  combineQualityDraft,
  normalizeGeminiResult,
  normalizeRuleResults,
} from "@/lib/translation-quality/normalizers/GeminiResultNormalizer";
import { PROMPT_VERSION } from "@/lib/translation-quality/prompts/translation-quality-v1";
import { TranslationQualityProviderFactory } from "@/lib/translation-quality/TranslationQualityProviderFactory";
import {
  claimQualityRun,
  finishQualityRun,
  getQualityRunRecord,
  latestTranslationVersion,
  listActiveBoilerplate,
  listActiveTerminology,
  listQualityCategories,
  persistQualityDetails,
} from "@/lib/translation-quality/repository";
import { BoilerplateRule } from "@/lib/translation-quality/rules/BoilerplateRule";
import { RuleEngine } from "@/lib/translation-quality/rules/RuleEngine";
import { TerminologyRule } from "@/lib/translation-quality/rules/TerminologyRule";
import {
  ANALYSIS_FAILED_MESSAGE,
  safeErrorMessage,
} from "@/lib/translation-quality/text";
import type {
  QualityCategoryConfig,
  TranslationQualityInput,
  TranslationQualityResult,
} from "@/lib/translation-quality/types";

export interface AnalyzeArticleInput {
  contentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTitle: string;
  sourceSummary: string;
  sourceContent: string;
  translatedTitle: string;
  translatedSummary: string;
  translatedContent: string;
}

function failedAiScores(
  categories: QualityCategoryConfig[],
  message: string
): ReturnType<typeof normalizeRuleResults> {
  return normalizeRuleResults(
    categories
      .filter((category) => category.categoryType === "ai")
      .map((category) => ({
        categoryCode: category.code,
        score: null,
        summary: message,
        error: message,
        findings: [],
      })),
    categories,
    {
      translatedTitle: "",
      translatedSummary: "",
      translatedContent: "",
    }
  );
}

export class TranslationQualityService {
  constructor(private readonly rules = new RuleEngine([
    new TerminologyRule(),
    new BoilerplateRule(),
  ])) {}

  async analyze(request: AnalyzeArticleInput): Promise<TranslationQualityResult> {
    const started = Date.now();
    const categories = await listQualityCategories(true);
    if (categories.length === 0) {
      throw new Error("No quality categories are enabled.");
    }
    const [terminology, boilerplate] = await Promise.all([
      listActiveTerminology(),
      listActiveBoilerplate(),
    ]);
    const input: TranslationQualityInput = {
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceTitle: request.sourceTitle,
      sourceSummary: request.sourceSummary,
      sourceContent: request.sourceContent,
      translatedTitle: request.translatedTitle,
      translatedSummary: request.translatedSummary,
      translatedContent: request.translatedContent,
      terminology,
      boilerplate,
      enabledCategories: categories,
    };
    const config = qualityConfig();
    const aiCategories = categories.filter((category) => category.categoryType === "ai");
    const providerId = config.provider;
    const version = await latestTranslationVersion(
      request.contentId,
      request.targetLanguage
    );
    const sameSavedText = Boolean(
      version &&
        version.title.trim() === request.translatedTitle.trim() &&
        version.summary.trim() === request.translatedSummary.trim() &&
        version.body.trim() === request.translatedContent.trim()
    );
    if (!sameSavedText || !version) {
      const preview = await this.score(input, categories, config, aiCategories, providerId, started);
      return {
        ...preview.result,
        runId: randomUUID(),
        createdAt: new Date().toISOString(),
        persisted: false,
      };
    }
    const savedInput: TranslationQualityInput = {
      ...input,
      translatedTitle: version.title,
      translatedSummary: version.summary,
      translatedContent: version.body,
    };
    const run = await claimQualityRun({
      contentId: request.contentId,
      contentTranslationId: version.translationId,
      versionId: version.versionId,
      versionCreatedAt: version.createdAt,
      provider: aiCategories.length > 0 ? providerId : "rules",
      model: aiCategories.length > 0 && providerId === "gemini" ? config.geminiModel : undefined,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      requestMetadata: {
        promptVersion: PROMPT_VERSION,
        enabledCategories: categories.map((category) => category.code),
        terminologyCount: terminology.length,
        boilerplateCount: boilerplate.length,
        versionNumber: version.versionNumber,
      },
    });
    if (run.existing) {
      const existing = await getQualityRunRecord(run.id);
      return existing;
    }

    try {
      const scored = await this.score(
        savedInput,
        categories,
        config,
        aiCategories,
        providerId,
        started
      );
      const { result: draftResult, metadata, errorMessage } = scored;
      await persistQualityDetails({
        runId: run.id,
        categories,
        scores: draftResult.scores,
        findings: draftResult.findings,
        actions: draftResult.actions,
      });
      await finishQualityRun({
        runId: run.id,
        status: draftResult.status,
        overallScore: draftResult.overallScore,
        responseMetadata: metadata,
        errorMessage,
      });

      return {
        ...draftResult,
        runId: run.id,
        createdAt: run.createdAt,
        persisted: true,
      };
    } catch (error) {
      const message = safeErrorMessage(error, config.geminiApiKey);
      await finishQualityRun({
        runId: run.id,
        status: "failed",
        overallScore: null,
        responseMetadata: {
          provider: providerId,
          promptVersion: PROMPT_VERSION,
          durationMs: Date.now() - started,
        },
        errorMessage: ANALYSIS_FAILED_MESSAGE,
      }).catch(() => undefined);
      throw new Error(message || ANALYSIS_FAILED_MESSAGE);
    }
  }

  private async score(
    input: TranslationQualityInput,
    categories: QualityCategoryConfig[],
    config: ReturnType<typeof qualityConfig>,
    aiCategories: QualityCategoryConfig[],
    providerId: string,
    started: number
  ) {
    const fields = {
      translatedTitle: input.translatedTitle ?? "",
      translatedSummary: input.translatedSummary ?? "",
      translatedContent: input.translatedContent,
    };
    let providerName = aiCategories.length > 0 ? providerId : "rules";
    let model = aiCategories.length > 0 && providerId === "gemini" ? config.geminiModel : undefined;
    let usage: { promptTokens?: number; outputTokens?: number } | undefined;
    let aiPiece = normalizeRuleResults([], categories, fields);
    let aiError: string | undefined;

    if (aiCategories.length > 0) {
      try {
        const provider = TranslationQualityProviderFactory.create(providerId);
        providerName = provider.id;
        const raw = await provider.analyze({
          ...input,
          enabledCategories: aiCategories,
        });
        model = raw.model ?? model;
        usage = raw.usage;
        aiPiece = normalizeGeminiResult(raw, categories, fields);
      } catch (error) {
        aiError = safeErrorMessage(error, config.geminiApiKey);
        aiPiece = failedAiScores(categories, aiError);
      }
    }

    const rulePiece = normalizeRuleResults(
      await this.rules.evaluate(input),
      categories,
      fields
    );
    const draft = combineQualityDraft([aiPiece, rulePiece], categories);
    const categoryErrors = draft.scores
      .filter((score) => score.error)
      .map((score) => ({ categoryCode: score.categoryCode, message: score.error ?? "" }));
    const scored = draft.scores.some((score) => typeof score.score === "number");
    const status = scored ? "completed" : "failed";
    const durationMs = Date.now() - started;
    const errorMessage = status === "failed" ? aiError || ANALYSIS_FAILED_MESSAGE : undefined;
    const metadata = {
      provider: providerName,
      model,
      promptVersion: PROMPT_VERSION,
      durationMs,
      partial: categoryErrors.length > 0 && scored,
      categoryErrors,
      usage,
    };
    const result: Omit<TranslationQualityResult, "runId" | "createdAt"> = {
      status,
      overallScore: draft.overallScore,
      scores: draft.scores,
      findings: draft.findings,
      actions: draft.actions,
      metadata: {
        provider: providerName,
        model,
        promptVersion: PROMPT_VERSION,
        durationMs,
        partial: metadata.partial,
        categoryErrors,
      },
      completedAt: new Date().toISOString(),
      persisted: false,
    };
    return { result, metadata, errorMessage };
  }
}

export function getTranslationQualityService() {
  return new TranslationQualityService();
}
