"use server";

import {
  acknowledgeIgnoredQualityAction as acknowledgeIgnored,
  analyzeTranslationQuality as analyze,
  createTerminologyEntry as createTerm,
  getTranslationQualityFindings as findings,
  getTranslationQualityRun as run,
  listQualitySettings as settings,
  loadTranslationQuality as load,
  previewQualityAction as preview,
  saveQualityCategories as saveCategories,
  saveReviewedContentTranslation as save,
  setQualityCategoryEnabled as setCategory,
  setTerminologyActive as setTerm,
  updateTerminologyEntry as updateTerm,
  deleteTerminologyEntries as deleteTerms,
  deleteTerminologyEntry as deleteTerm,
  listTerminologyEntries as listTerms,
} from "@/lib/translation-quality/handlers";
import type { SourceContentFields } from "@/lib/types";

export async function loadTranslationQuality(input: {
  contentId: string;
  languageCode: string;
}) {
  try {
    return { bundle: await load(input), error: "" };
  } catch (error) {
    return {
      bundle: null,
      error: error instanceof Error ? error.message : "Could not load quality review.",
    };
  }
}

export async function analyzeTranslationQuality(input: {
  applicationId: string;
  contentId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTitle: string;
  sourceSummary: string;
  sourceContent: string;
  translatedTitle: string;
  translatedSummary: string;
  translatedContent: string;
}) {
  try {
    return { result: await analyze(input), error: "" };
  } catch (error) {
    return {
      result: null,
      error:
        error instanceof Error
          ? error.message
          : "Quality analysis failed. Please try again.",
    };
  }
}

export async function getTranslationQualityRun(runId: string) {
  return run(runId);
}

export async function getTranslationQualityFindings(runId: string) {
  return findings(runId);
}

export async function previewQualityAction(input: {
  actionId: string;
  title?: string;
  summary?: string;
  content?: string;
}) {
  return preview(input);
}

export async function acknowledgeIgnoredQualityAction(actionId: string) {
  return acknowledgeIgnored(actionId);
}

export async function saveReviewedContentTranslation(input: {
  contentId: string;
  languageCode: string;
  fields: SourceContentFields;
  applicationId: string;
  qualityRunId?: string | null;
  acceptedActionIds?: string[];
  ignoredActionIds?: string[];
}) {
  return save(input);
}

export async function listQualitySettings(applicationId: string) {
  return settings(applicationId);
}

export async function setQualityCategoryEnabled(input: {
  applicationId: string;
  categoryId: string;
  enabled: boolean;
}) {
  return setCategory(input);
}

export async function createTerminologyEntry(input: {
  applicationId: string;
  term: string;
  sourceLanguage: string;
  targetLanguage: string;
  preferredTranslation: string;
  forbiddenTranslations: string;
  category: string;
  definition: string;
  isActive?: boolean;
}) {
  return createTerm(input);
}

export async function setTerminologyActive(input: {
  applicationId: string;
  terminologyId: string;
  isActive: boolean;
}) {
  return setTerm(input);
}

export async function saveQualityCategories(input: {
  applicationId: string;
  categories: Array<{ id: string; enabled: boolean; weight: number }>;
}) {
  return saveCategories(input);
}

export async function updateTerminologyEntry(input: {
  applicationId: string;
  terminologyId: string;
  term: string;
  sourceLanguage: string;
  targetLanguage: string;
  preferredTranslation: string;
  forbiddenTranslations: string;
  category: string;
  definition: string;
  isActive: boolean;
}) {
  return updateTerm(input);
}

export async function deleteTerminologyEntry(input: {
  applicationId: string;
  terminologyId: string;
}) {
  return deleteTerm(input);
}

export async function deleteTerminologyEntries(input: {
  applicationId: string;
  terminologyIds: string[];
}) {
  return deleteTerms(input);
}

export async function listTerminologyEntries(input: {
  applicationId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  status?: string;
}) {
  return listTerms(input);
}
