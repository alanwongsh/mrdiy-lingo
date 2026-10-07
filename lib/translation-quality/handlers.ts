import { revalidatePath } from "next/cache";
import { approvalStamp, versionAuthorFields } from "@/lib/auth/actor";
import {
  requireAppCapability,
  requireContentAccess,
} from "@/lib/auth/access";
import { saveManualContentTranslation } from "@/lib/actions/press";
import { getDb } from "@/lib/db/client";
import type { ContentTranslation, SourceContentFields } from "@/lib/types";
import { applyQualityAction } from "@/lib/translation-quality/apply-action";
import { qualitySchemaMessage } from "@/lib/translation-quality/repository";
import {
  findVersionQualityRun,
  getQualityActionRow,
  getQualityRunRecord,
  latestTranslationVersion,
  listQualityCategories,
  listQualityRunSummaries,
  listTerminologyPage,
  versionRunUsesTokens,
} from "@/lib/translation-quality/repository";
import { getTranslationQualityService } from "@/lib/translation-quality/TranslationQualityService";
import type {
  QualityAction,
  TranslationQualityBundle,
} from "@/lib/translation-quality/types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function assertUuid(value: string, label: string) {
  if (!UUID.test(value)) throw new Error(`Invalid ${label}.`);
}

function assertLanguage(value: string, label: string) {
  const trimmed = value.trim();
  if (!LANGUAGE.test(trimmed)) throw new Error(`Invalid ${label}.`);
  return trimmed;
}

function optionalLanguage(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !LANGUAGE.test(trimmed)) return "";
  return trimmed;
}

function revalidateQuality(applicationId: string) {
  revalidatePath(`/applications/${applicationId}/settings/quality`);
  revalidatePath(`/applications/${applicationId}/quality`);
}

function bounded(value: string, max: number, label: string) {
  const text = value ?? "";
  if (text.length > max) throw new Error(`${label} is too long to analyze.`);
  return text;
}

function uniqueIds(values: string[] | undefined) {
  const ids = [...new Set((values ?? []).map((id) => id.trim()).filter(Boolean))];
  for (const id of ids) assertUuid(id, "action");
  return ids;
}

export async function loadTranslationQuality(input: {
  contentId: string;
  languageCode: string;
}): Promise<TranslationQualityBundle> {
  assertUuid(input.contentId, "article");
  const languageCode = assertLanguage(input.languageCode, "language");
  await requireContentAccess(input.contentId, "view");
  const [categories, runs, version] = await Promise.all([
    listQualityCategories(false),
    listQualityRunSummaries(input.contentId, languageCode),
    latestTranslationVersion(input.contentId, languageCode),
  ]);
  const versionRun = version ? await findVersionQualityRun(version.versionId) : null;
  const currentSummary = versionRun
    ? runs.find((run) => run.id === versionRun.id) ?? null
    : null;
  const latest = versionRun ? await getQualityRunRecord(versionRun.id) : null;
  const canAnalyze = Boolean(version) && (!versionRun || !versionRunUsesTokens(versionRun));
  return {
    categories,
    runs: currentSummary ? [currentSummary, ...runs.filter((run) => run.id !== currentSummary.id)] : runs,
    latest,
    versionId: version?.versionId ?? null,
    versionNumber: version?.versionNumber ?? null,
    canAnalyze,
  };
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
  assertUuid(input.applicationId, "application");
  assertUuid(input.contentId, "article");
  const sourceLanguage = assertLanguage(input.sourceLanguage, "source language");
  const targetLanguage = assertLanguage(input.targetLanguage, "target language");
  if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
    throw new Error("Choose a target language that differs from the source.");
  }
  const grant = await requireContentAccess(input.contentId, "edit");
  if (grant.applicationId !== input.applicationId) {
    throw new Error("Article not found.");
  }
  const translatedTitle = bounded(input.translatedTitle ?? "", 2000, "Title");
  const translatedSummary = bounded(input.translatedSummary ?? "", 8000, "Description");
  const translatedContent = bounded(input.translatedContent ?? "", 100000, "Body");
  if (!translatedTitle.trim() && !translatedSummary.trim() && !translatedContent.trim()) {
    throw new Error("Add a translation before analyzing it.");
  }

  return getTranslationQualityService().analyze({
    contentId: input.contentId,
    sourceLanguage,
    targetLanguage,
    sourceTitle: bounded(input.sourceTitle ?? "", 2000, "Source title"),
    sourceSummary: bounded(input.sourceSummary ?? "", 8000, "Source description"),
    sourceContent: bounded(input.sourceContent ?? "", 100000, "Source body"),
    translatedTitle,
    translatedSummary,
    translatedContent,
  });
}

export async function getTranslationQualityRun(runId: string) {
  assertUuid(runId, "analysis");
  const run = await getQualityRunRecord(runId);
  await requireContentAccess(run.contentId, "view");
  return run;
}

export async function getTranslationQualityFindings(runId: string) {
  const run = await getTranslationQualityRun(runId);
  return { findings: run.findings, actions: run.actions };
}

export async function previewQualityAction(input: {
  actionId: string;
  title?: string;
  summary?: string;
  content?: string;
}) {
  assertUuid(input.actionId, "action");
  const row = await getQualityActionRow(input.actionId);
  await requireContentAccess(row.contentId, "view");
  const fields: SourceContentFields = {
    title: input.title ?? "",
    summary: input.summary ?? "",
    body: input.content ?? "",
    seo_title: "",
    seo_description: "",
  };
  const next = applyQualityAction(fields, row.action);
  const text =
    row.action.targetField === "content"
      ? next.body
      : next[row.action.targetField];
  return {
    actionId: row.action.id,
    targetField: row.action.targetField,
    text,
  };
}

/** Confirms a pending suggestion can be ignored in the editor session. Persistence happens on Save. */
export async function acknowledgeIgnoredQualityAction(actionId: string) {
  assertUuid(actionId, "action");
  const row = await getQualityActionRow(actionId);
  await requireContentAccess(row.contentId, "edit");
  if (row.action.status !== "pending") {
    throw new Error("This suggestion is no longer pending.");
  }
  return {
    id: row.action.id,
    status: "pending" as const,
    sessionStatus: "ignored" as const,
  };
}

export async function saveReviewedContentTranslation(input: {
  contentId: string;
  languageCode: string;
  fields: SourceContentFields;
  applicationId: string;
  qualityRunId?: string | null;
  acceptedActionIds?: string[];
  ignoredActionIds?: string[];
}): Promise<ContentTranslation> {
  const accepted = uniqueIds(input.acceptedActionIds);
  const ignored = uniqueIds(input.ignoredActionIds);
  if (accepted.length === 0 && ignored.length === 0) {
    return saveManualContentTranslation({
      contentId: input.contentId,
      languageCode: input.languageCode,
      fields: input.fields,
      applicationId: input.applicationId,
    });
  }

  const grant = await requireContentAccess(input.contentId, "edit");
  if (grant.applicationId !== input.applicationId) {
    throw new Error("Article not found.");
  }
  const approver = grant.access.can_approve;
  const status = approver ? "APPROVED" : "MANUALLY_MODIFIED";
  const approval = await approvalStamp(status, grant.user.id);
  const actor = await versionAuthorFields("MANUAL");
  if (input.qualityRunId) assertUuid(input.qualityRunId, "analysis");
  const overlap = accepted.some((id) => ignored.includes(id));
  if (overlap) throw new Error("An action cannot be both accepted and ignored.");

  const db = await getDb();
  const { data, error } = await db.rpc("commit_content_translation_quality", {
    p_content_id: input.contentId,
    p_language_code: input.languageCode,
    p_title: input.fields.title,
    p_summary: input.fields.summary,
    p_body: input.fields.body,
    p_seo_title: input.fields.seo_title,
    p_seo_description: input.fields.seo_description,
    p_status: status,
    p_source_type: "MANUAL",
    p_approved_by_username: approval.approved_by_username,
    p_approved_by_name: approval.approved_by_name,
    p_approved_by_user_id: approval.approved_by_user_id,
    p_approved_at: approval.approved_at,
    p_author: actor.author,
    p_author_username: actor.author_username,
    p_author_user_id: grant.user.id,
    p_approver: approver,
    p_quality_run_id: input.qualityRunId,
    p_accepted_action_ids: accepted,
    p_ignored_action_ids: ignored,
  });
  if (error) throw new Error(qualitySchemaMessage(error));

  const { data: translation, error: readError } = await db
    .from("content_translations")
    .select("*")
    .eq("id", data as string)
    .single();
  if (readError) throw new Error(readError.message);

  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(
    `/applications/${input.applicationId}/articles/${input.contentId}`
  );
  return translation as ContentTranslation;
}

export async function listQualitySettings(applicationId: string) {
  assertUuid(applicationId, "application");
  await requireAppCapability(applicationId, "view");
  const categories = await listQualityCategories(false);
  return { categories };
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
  assertUuid(input.applicationId, "application");
  await requireAppCapability(input.applicationId, "view");
  const status = input.status === "active" || input.status === "inactive" ? input.status : "";
  return listTerminologyPage({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 50,
    search: input.search?.slice(0, 120),
    sourceLanguage: optionalLanguage(input.sourceLanguage),
    targetLanguage: optionalLanguage(input.targetLanguage),
    active: status === "active" ? true : status === "inactive" ? false : undefined,
  });
}

export async function saveQualityCategories(input: {
  applicationId: string;
  categories: Array<{ id: string; enabled: boolean; weight: number }>;
}) {
  assertUuid(input.applicationId, "application");
  await requireAppCapability(input.applicationId, "manage");
  if (input.categories.length === 0 || input.categories.length > 40) {
    throw new Error("Choose the categories to save.");
  }
  const ids = input.categories.map((item) => {
    assertUuid(item.id, "category");
    return item.id;
  });
  const db = await getDb();
  const { data, error } = await db
    .from("quality_categories")
    .select("id, configuration")
    .in("id", ids);
  if (error) throw new Error(qualitySchemaMessage(error));
  const stored = new Map(
    (data ?? []).map((row) => [row.id as string, row.configuration])
  );
  if (stored.size !== ids.length) throw new Error("A category was not found.");

  for (const item of input.categories) {
    const weight = Number(item.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
      throw new Error("Each share must be a whole number from 1 to 100.");
    }
    const current =
      stored.get(item.id) && typeof stored.get(item.id) === "object"
        ? (stored.get(item.id) as Record<string, unknown>)
        : {};
    const { error: updateError } = await db
      .from("quality_categories")
      .update({
        enabled: Boolean(item.enabled),
        configuration: { ...current, weight },
      })
      .eq("id", item.id);
    if (updateError) throw new Error(qualitySchemaMessage(updateError));
  }
  revalidateQuality(input.applicationId);
}

export async function setQualityCategoryEnabled(input: {
  applicationId: string;
  categoryId: string;
  enabled: boolean;
}) {
  assertUuid(input.applicationId, "application");
  assertUuid(input.categoryId, "category");
  await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const { error } = await db
    .from("quality_categories")
    .update({ enabled: input.enabled })
    .eq("id", input.categoryId);
  if (error) throw new Error(qualitySchemaMessage(error));
  revalidateQuality(input.applicationId);
}

function terminologyFields(input: {
  term: string;
  sourceLanguage: string;
  targetLanguage: string;
  preferredTranslation: string;
  forbiddenTranslations: string;
  category: string;
  definition: string;
  isActive?: boolean;
}) {
  const term = input.term.trim();
  const sourceLanguage = assertLanguage(input.sourceLanguage, "source language");
  const targetLanguage = assertLanguage(input.targetLanguage, "target language");
  if (!term || term.length > 120) throw new Error("Enter a term.");
  const preferred = input.preferredTranslation.trim();
  if (!preferred || preferred.length > 200) {
    throw new Error("Enter the wording to use.");
  }
  const forbidden = input.forbiddenTranslations
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
  return {
    term,
    definition: input.definition.trim().slice(0, 500),
    source_language: sourceLanguage,
    target_language: targetLanguage,
    preferred_translation: preferred,
    forbidden_translations: forbidden,
    category: input.category.trim().slice(0, 80),
    is_active: input.isActive !== false,
  };
}

function throwTerminologyError(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    throw new Error("That term already exists for this language pair.");
  }
  throw new Error(qualitySchemaMessage(error));
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
  assertUuid(input.applicationId, "application");
  await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const { error } = await db.from("terminology").insert({
    ...terminologyFields(input),
    description: "",
    context: "",
    example: "",
  });
  if (error) throwTerminologyError(error);
  revalidateQuality(input.applicationId);
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
  assertUuid(input.applicationId, "application");
  assertUuid(input.terminologyId, "term");
  await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const { error } = await db
    .from("terminology")
    .update(terminologyFields(input))
    .eq("id", input.terminologyId);
  if (error) throwTerminologyError(error);
  revalidateQuality(input.applicationId);
}

export async function deleteTerminologyEntry(input: {
  applicationId: string;
  terminologyId: string;
}) {
  return deleteTerminologyEntries({
    applicationId: input.applicationId,
    terminologyIds: [input.terminologyId],
  });
}

export async function deleteTerminologyEntries(input: {
  applicationId: string;
  terminologyIds: string[];
}) {
  assertUuid(input.applicationId, "application");
  await requireAppCapability(input.applicationId, "manage");
  const ids = [...new Set(input.terminologyIds)];
  if (ids.length === 0 || ids.length > 100) {
    throw new Error("Choose the words to delete.");
  }
  for (const id of ids) assertUuid(id, "term");
  const db = await getDb();
  const { error } = await db.from("terminology").delete().in("id", ids);
  if (error) throw new Error(qualitySchemaMessage(error));
  revalidateQuality(input.applicationId);
}

export async function setTerminologyActive(input: {
  applicationId: string;
  terminologyId: string;
  isActive: boolean;
}) {
  assertUuid(input.applicationId, "application");
  assertUuid(input.terminologyId, "term");
  await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const { error } = await db
    .from("terminology")
    .update({ is_active: input.isActive })
    .eq("id", input.terminologyId);
  if (error) throw new Error(qualitySchemaMessage(error));
  revalidateQuality(input.applicationId);
}

export type { QualityAction };
