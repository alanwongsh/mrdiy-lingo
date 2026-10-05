"use server";

import { revalidatePath } from "next/cache";
import { escapeIlike, getDb } from "@/lib/db/client";
import type {
  Content,
  ContentLifecycleStatus,
  ContentTranslation,
  ContentTranslationVersion,
  ContentType,
  Paginated,
  SourceContentFields,
  SourceType,
  TranslationStatus,
} from "@/lib/types";
import { approvalStamp, getActor, versionAuthorFields } from "@/lib/auth/actor";
import {
  allowAppCapability,
  capabilityForReleaseStatus,
  requireAppCapability,
  requireContentAccess,
  requireContentTranslationAccess,
  requireContentVersionAccess,
  requireUser,
} from "@/lib/auth/access";
import { emptySourceContent } from "@/lib/types";
import { getTranslationService } from "@/lib/translation/service";
import { normalizeSlug } from "@/lib/slug";
import { DUE_SOON_MS, type PublishDueKind } from "@/lib/publish-due";
import { languageKey, normalizeTargetLanguages } from "@/lib/target-languages";
import { normalizeMarket } from "@/lib/markets";
import { buildArticleWorkbook } from "@/lib/export/articles";

function asSourceContent(value: unknown): SourceContentFields {
  const v = (value ?? {}) as Partial<SourceContentFields>;
  return {
    title: v.title ?? "",
    summary: v.summary ?? "",
    body: v.body ?? "",
    seo_title: v.seo_title ?? "",
    seo_description: v.seo_description ?? "",
  };
}

function publishTimestampPatch(
  nextStatus: ContentLifecycleStatus,
  currentPublishedAt: string | null | undefined
): { published_at: string | null } {
  if (nextStatus === "PUBLISHED") {
    return {
      published_at: currentPublishedAt ?? new Date().toISOString(),
    };
  }
  return { published_at: null };
}

function sameCodeSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const left = new Set(a.map((code) => code.toLowerCase()));
  return b.every((code) => left.has(code.toLowerCase()));
}

function sourceContentChanged(
  current: SourceContentFields,
  next: SourceContentFields
) {
  return (
    ["title", "summary", "body", "seo_title", "seo_description"] as const
  ).some((field) => (current[field] ?? "") !== (next[field] ?? ""));
}

async function clearTargetApprovals(contentId: string, sourceLanguage: string) {
  const db = await getDb();
  const { data, error } = await db
    .from("content_translations")
    .select("id, language_code")
    .eq("content_id", contentId)
    .eq("status", "APPROVED");
  if (error) throw new Error(error.message);
  const source = sourceLanguage.trim().toLowerCase();
  const ids = (data ?? [])
    .filter(
      (row) => String(row.language_code).trim().toLowerCase() !== source
    )
    .map((row) => row.id as string);
  if (ids.length === 0) return;
  const { error: updateError } = await db
    .from("content_translations")
    .update({
      status: "MANUALLY_MODIFIED",
      approved_by_username: null,
      approved_by_name: null,
      approved_by_user_id: null,
      approved_at: null,
    })
    .in("id", ids);
  if (updateError) throw new Error(updateError.message);
}

async function targetsAllApproved(
  contentId: string,
  sourceLanguage: string,
  targetLanguages: string[]
) {
  const targets = normalizeTargetLanguages(targetLanguages, sourceLanguage);
  if (targets.length === 0) return false;
  const db = await getDb();
  const { data, error } = await db
    .from("content_translations")
    .select("language_code, status")
    .eq("content_id", contentId);
  if (error) throw new Error(error.message);
  const approved = new Set(
    (data ?? [])
      .filter((row) => row.status === "APPROVED")
      .map((row) => String(row.language_code).trim().toLowerCase())
  );
  return targets.every((code) => approved.has(code.toLowerCase()));
}

async function syncArticleStatusFromApprovals(
  contentId: string,
  applicationId: string
) {
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select("status, source_language, target_languages")
    .eq("id", contentId)
    .single();
  if (error) throw new Error(error.message);
  const allApproved = await targetsAllApproved(
    contentId,
    data.source_language,
    data.target_languages ?? []
  );
  if (
    allApproved &&
    data.status !== "APPROVED" &&
    data.status !== "PUBLISHED"
  ) {
    await setArticleStatus(contentId, applicationId, "APPROVED");
  } else if (
    !allApproved &&
    (data.status === "APPROVED" || data.status === "PUBLISHED")
  ) {
    await setArticleStatus(contentId, applicationId, "REVIEW");
  }
}

function mapContentRow(data: Content): Content {
  return {
    ...data,
    slug: data.slug ?? null,
    scheduled_publish_at: data.scheduled_publish_at ?? null,
    published_at: data.published_at ?? null,
    target_languages: normalizeTargetLanguages(
      data.target_languages,
      data.source_language
    ),
    market: data.market ?? null,
    submitted_by_name: data.submitted_by_name ?? null,
    submitted_by_username: data.submitted_by_username ?? null,
    source_content: asSourceContent(data.source_content),
  };
}

export type ArticleListItem = Content & {
  translations: Pick<
    ContentTranslation,
    "id" | "language_code" | "status" | "title"
  >[];
};

export async function listArticles(input: {
  applicationId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ContentLifecycleStatus;
  contentType?: ContentType;
  sourceLanguages?: string[];
  market?: string;
  due?: PublishDueKind;
}): Promise<Paginated<ArticleListItem>> {
  await requireAppCapability(input.applicationId, "view");
  const db = await getDb();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const now = new Date();
  const nowIso = now.toISOString();
  const soonIso = new Date(now.getTime() + DUE_SOON_MS).toISOString();

  let query = db
    .from("content")
    .select(
      "*, translations:content_translations(id, language_code, status, title)",
      { count: "exact" }
    )
    .eq("application_id", input.applicationId)
    .order("scheduled_publish_at", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (input.status) query = query.eq("status", input.status);
  if (input.contentType) query = query.eq("content_type", input.contentType);
  const sourceLanguages = [
    ...new Set(
      (input.sourceLanguages ?? [])
        .map((code) => code.trim())
        .filter(Boolean)
    ),
  ];
  if (sourceLanguages.length === 1) {
    query = query.eq("source_language", sourceLanguages[0]);
  } else if (sourceLanguages.length > 1) {
    query = query.in("source_language", sourceLanguages);
  }
  const market = normalizeMarket(input.market);
  if (market) query = query.eq("market", market);
  if (input.search?.trim()) {
    const term = escapeIlike(input.search.trim());
    query = query.ilike("title", `%${term}%`);
  }

  if (input.due === "published") {
    query = query.or("status.eq.PUBLISHED,published_at.not.is.null");
  } else if (input.due === "none") {
    query = query
      .neq("status", "PUBLISHED")
      .is("published_at", null)
      .is("scheduled_publish_at", null);
  } else if (input.due === "overdue") {
    query = query
      .neq("status", "PUBLISHED")
      .is("published_at", null)
      .not("scheduled_publish_at", "is", null)
      .lt("scheduled_publish_at", nowIso);
  } else if (input.due === "due_soon") {
    query = query
      .neq("status", "PUBLISHED")
      .is("published_at", null)
      .gte("scheduled_publish_at", nowIso)
      .lte("scheduled_publish_at", soonIso);
  } else if (input.due === "scheduled") {
    query = query
      .neq("status", "PUBLISHED")
      .is("published_at", null)
      .gt("scheduled_publish_at", soonIso);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    items: ((data ?? []) as ArticleListItem[]).map((item) => ({
      ...mapContentRow(item),
      translations: item.translations ?? [],
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function countArticlesNeedingReview(
  applicationIds: string[]
): Promise<Record<string, number>> {
  const ids = [...new Set(applicationIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  await requireUser();
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select("application_id")
    .eq("status", "REVIEW")
    .in("application_id", ids);
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = String(row.application_id ?? "");
    if (!id) continue;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export async function getArticle(id: string): Promise<
  | (Content & {
      translations: ContentTranslation[];
    })
  | null
> {
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select("*, translations:content_translations(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const allowed = await allowAppCapability(
    (data as Content).application_id,
    "view"
  );
  if (!allowed) return null;
  return {
    ...mapContentRow(data as Content),
    translations: (data.translations ?? []) as ContentTranslation[],
  };
}

export async function createArticle(input: {
  application_id: string;
  content_type?: ContentType;
  title: string;
  /** `null` stores no slug. Omitted values are generated from the title. */
  slug?: string | null;
  source_language: string;
  source_content: SourceContentFields;
  status?: ContentLifecycleStatus;
  scheduled_publish_at?: string | null;
  target_languages?: string[];
  market?: string | null;
}): Promise<Content> {
  const status = input.status ?? "DRAFT";
  await requireAppCapability(
    input.application_id,
    capabilityForReleaseStatus(status)
  );
  const db = await getDb();
  const source_content = {
    ...emptySourceContent(),
    ...input.source_content,
    title: input.source_content.title || input.title,
  };
  const target_languages = normalizeTargetLanguages(
    input.target_languages,
    input.source_language
  );
  const actor = await getActor();
  const { data, error } = await db
    .from("content")
    .insert({
      application_id: input.application_id,
      content_type: input.content_type ?? "ARTICLE",
      title: input.title.trim(),
      slug:
        input.slug === null ? null : normalizeSlug(input.slug, input.title),
      source_language: input.source_language,
      source_content,
      status,
      target_languages,
      market: normalizeMarket(input.market),
      submitted_by_name: actor?.name ?? null,
      submitted_by_username: actor?.username ?? null,
      scheduled_publish_at: input.scheduled_publish_at || null,
      ...publishTimestampPatch(status, null),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await upsertContentTranslation({
    content_id: data.id,
    language_code: input.source_language,
    fields: source_content,
    source_type: "MANUAL",
    status: "MANUALLY_MODIFIED",
  });

  revalidatePath(`/applications/${input.application_id}`);
  return mapContentRow(data as Content);
}

export async function updateArticle(
  id: string,
  applicationId: string,
  input: {
    title: string;
    slug?: string | null;
    content_type: ContentType;
    source_language: string;
    source_content: SourceContentFields;
    status: ContentLifecycleStatus;
    scheduled_publish_at?: string | null;
    target_languages?: string[];
    market?: string | null;
  }
): Promise<Content> {
  await requireContentAccess(id, capabilityForReleaseStatus(input.status));
  const db = await getDb();
  const { data: current, error: currentError } = await db
    .from("content")
    .select(
      "published_at, status, source_language, source_content, target_languages, submitted_by_name"
    )
    .eq("id", id)
    .single();
  if (currentError) throw new Error(currentError.message);

  const sourceChanged =
    String(current.source_language).trim().toLowerCase() !==
      input.source_language.trim().toLowerCase() ||
    sourceContentChanged(
      asSourceContent(current.source_content),
      input.source_content
    );
  const currentTargets = normalizeTargetLanguages(
    current.target_languages,
    current.source_language
  );
  const nextTargets =
    input.target_languages !== undefined
      ? normalizeTargetLanguages(input.target_languages, input.source_language)
      : currentTargets;
  const targetsChanged =
    input.target_languages !== undefined &&
    !sameCodeSet(currentTargets, nextTargets);

  if (sourceChanged) {
    await clearTargetApprovals(id, input.source_language);
  }

  const released =
    current.status === "APPROVED" || current.status === "PUBLISHED";
  const markingReleased =
    input.status === "APPROVED" || input.status === "PUBLISHED";
  let nextStatus = input.status;
  if (sourceChanged && (released || markingReleased)) {
    nextStatus = "REVIEW";
  } else if (targetsChanged && (released || markingReleased)) {
    const allApproved = await targetsAllApproved(
      id,
      input.source_language,
      nextTargets
    );
    if (!allApproved) nextStatus = "REVIEW";
  }

  const patch: Record<string, unknown> = {
    title: input.title.trim(),
    slug: (input.slug ?? "").trim()
      ? normalizeSlug(input.slug, input.title)
      : null,
    content_type: input.content_type,
    source_language: input.source_language,
    source_content: input.source_content,
    status: nextStatus,
    ...publishTimestampPatch(nextStatus, current.published_at),
  };
  if (input.scheduled_publish_at !== undefined) {
    patch.scheduled_publish_at = input.scheduled_publish_at || null;
  }
  if (input.target_languages !== undefined) {
    patch.target_languages = nextTargets;
  }
  if (input.market !== undefined) {
    patch.market = normalizeMarket(input.market);
  }
  if (!current.submitted_by_name) {
    const actor = await getActor();
    if (actor) {
      patch.submitted_by_name = actor.name;
      patch.submitted_by_username = actor.username;
    }
  }

  const { data, error } = await db
    .from("content")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  if (targetsChanged) {
    await syncArticleStatusFromApprovals(id, applicationId);
  }
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/articles/${id}`);
  return mapContentRow(data as Content);
}

export async function setArticleStatus(
  id: string,
  applicationId: string,
  status: ContentLifecycleStatus
): Promise<void> {
  await requireContentAccess(id, capabilityForReleaseStatus(status));
  const db = await getDb();
  const { data: current, error: currentError } = await db
    .from("content")
    .select("published_at")
    .eq("id", id)
    .single();
  if (currentError) throw new Error(currentError.message);

  const { error } = await db
    .from("content")
    .update({
      status,
      ...publishTimestampPatch(status, current.published_at),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/articles/${id}`);
}

export async function deleteArticle(input: {
  contentId: string;
  applicationId: string;
}): Promise<void> {
  await deleteArticles({
    contentIds: [input.contentId],
    applicationId: input.applicationId,
  });
}

export async function deleteArticles(input: {
  contentIds: string[];
  applicationId: string;
}): Promise<{ deleted: number }> {
  await requireAppCapability(input.applicationId, "edit");
  const ids = [...new Set(input.contentIds.filter(Boolean))];
  if (ids.length === 0) return { deleted: 0 };

  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .delete()
    .eq("application_id", input.applicationId)
    .in("id", ids)
    .select("id");
  if (error) throw new Error(error.message);

  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(`/applications/${input.applicationId}/articles`);
  return { deleted: data?.length ?? 0 };
}

async function nextContentVersionNumber(
  contentTranslationId: string
): Promise<number> {
  const db = await getDb();
  const { data, error } = await db
    .from("content_translation_versions")
    .select("version_number")
    .eq("content_translation_id", contentTranslationId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.version_number ?? 0) + 1;
}

export async function upsertContentTranslation(input: {
  content_id: string;
  language_code: string;
  fields: SourceContentFields;
  source_type: SourceType;
  status?: TranslationStatus;
}): Promise<ContentTranslation> {
  const status: TranslationStatus =
    input.status ??
    (input.source_type === "MANUAL"
      ? "MANUALLY_MODIFIED"
      : input.source_type === "SYSTEM"
        ? "SYSTEM_GENERATED"
        : "MANUALLY_MODIFIED");
  const grant = await requireContentAccess(
    input.content_id,
    status === "APPROVED" ? "approve" : "edit"
  );
  const db = await getDb();

  const { data: existing, error: findError } = await db
    .from("content_translations")
    .select("*")
    .eq("content_id", input.content_id)
    .eq("language_code", input.language_code)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  const payload = {
    title: input.fields.title,
    summary: input.fields.summary,
    body: input.fields.body,
    seo_title: input.fields.seo_title,
    seo_description: input.fields.seo_description,
    status,
    approved_by_username: null,
    approved_by_name: null,
    approved_by_user_id: null,
    approved_at: null,
  };

  let translation: ContentTranslation;
  if (existing) {
    const unchanged =
      existing.title === payload.title &&
      existing.summary === payload.summary &&
      existing.body === payload.body &&
      existing.seo_title === payload.seo_title &&
      existing.seo_description === payload.seo_description &&
      existing.status === payload.status;
    if (unchanged) return existing as ContentTranslation;

    const { data, error } = await db
      .from("content_translations")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    translation = data as ContentTranslation;
  } else {
    const { data, error } = await db
      .from("content_translations")
      .insert({
        content_id: input.content_id,
        language_code: input.language_code,
        ...payload,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    translation = data as ContentTranslation;
  }

  const versionNumber = await nextContentVersionNumber(translation.id);
  const actorFields = await versionAuthorFields(input.source_type);
  const { error: versionError } = await db
    .from("content_translation_versions")
    .insert({
      content_translation_id: translation.id,
      version_number: versionNumber,
      translated_content: input.fields,
      source_type: input.source_type,
      author_user_id: grant.user.id,
      ...actorFields,
    });
  if (versionError) throw new Error(versionError.message);

  return translation;
}

export async function listContentTranslationVersions(
  contentTranslationId: string
): Promise<ContentTranslationVersion[]> {
  await requireContentTranslationAccess(contentTranslationId, "view");
  const db = await getDb();
  const { data, error } = await db
    .from("content_translation_versions")
    .select("*")
    .eq("content_translation_id", contentTranslationId)
    .order("version_number", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ContentTranslationVersion[]).map((v) => ({
    ...v,
    translated_content: asSourceContent(v.translated_content),
  }));
}

export async function deleteContentTranslationVersion(input: {
  versionId: string;
  applicationId: string;
  contentId: string;
}): Promise<void> {
  await requireContentVersionAccess(input.versionId, "edit");
  const db = await getDb();
  const { error } = await db
    .from("content_translation_versions")
    .delete()
    .eq("id", input.versionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(
    `/applications/${input.applicationId}/articles/${input.contentId}`
  );
}

export async function setContentTranslationStatus(input: {
  contentTranslationId: string;
  status: TranslationStatus;
  applicationId: string;
  contentId: string;
}): Promise<void> {
  const grant = await requireContentTranslationAccess(
    input.contentTranslationId,
    input.status === "APPROVED" ? "approve" : "edit"
  );
  const db = await getDb();
  const approval = await approvalStamp(input.status, grant.user.id);
  const { error } = await db
    .from("content_translations")
    .update({ status: input.status, ...approval })
    .eq("id", input.contentTranslationId);
  if (error) throw new Error(error.message);
  await syncArticleStatusFromApprovals(input.contentId, input.applicationId);
  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(
    `/applications/${input.applicationId}/articles/${input.contentId}`
  );
}

function preferField(live: string | undefined, stored: string): string {
  if (live != null && live.trim()) return live;
  return stored ?? "";
}

export async function autoTranslateArticle(input: {
  contentId: string;
  targetLanguage: string;
  applicationId: string;
  /** Prefer live editor content over DB when provided. */
  sourceFields?: SourceContentFields;
  /** Prefer live source-language selection over DB when provided. */
  sourceLanguage?: string;
}): Promise<ContentTranslation> {
  await requireContentAccess(input.contentId, "edit");
  const article = await getArticle(input.contentId);
  if (!article) throw new Error("Article not found");

  const sourceLanguage =
    input.sourceLanguage?.trim() || article.source_language;
  if (languageKey(sourceLanguage) === languageKey(input.targetLanguage)) {
    throw new Error("Target language must differ from source language.");
  }

  const stored = article.source_content;
  const live = input.sourceFields;
  // Never let empty editor state overwrite a non-empty stored body/title.
  const sourceFields: SourceContentFields = {
    title:
      preferField(live?.title, stored.title) || article.title || "",
    summary: preferField(live?.summary, stored.summary),
    body: preferField(live?.body, stored.body),
    seo_title: preferField(
      live?.seo_title,
      stored.seo_title || stored.title || article.title || ""
    ),
    seo_description: preferField(
      live?.seo_description,
      stored.seo_description || stored.summary
    ),
  };

  if (!sourceFields.body?.trim() && !sourceFields.title?.trim()) {
    throw new Error(
      "Nothing to translate — save the source title/body first."
    );
  }

  await setArticleStatus(input.contentId, input.applicationId, "TRANSLATING");

  // Persist latest source / language so translation isn't based on stale DB content.
  const liveHasContent = Boolean(
    live &&
      (live.title?.trim() ||
        live.summary?.trim() ||
        live.body?.trim())
  );
  const languageChanged = sourceLanguage !== article.source_language;
  if (liveHasContent || languageChanged) {
    await updateArticle(input.contentId, input.applicationId, {
      title: sourceFields.title || article.title,
      slug: null,
      content_type: article.content_type,
      source_language: sourceLanguage,
      source_content: sourceFields,
      status: "TRANSLATING",
      scheduled_publish_at: article.scheduled_publish_at,
      target_languages: normalizeTargetLanguages(
        article.target_languages,
        sourceLanguage
      ),
    });
  }

  const service = getTranslationService();
  const fields = await service.translateArticle({
    fields: sourceFields,
    sourceLanguage,
    targetLanguage: input.targetLanguage,
  });

  if (!fields.body?.trim() && sourceFields.body?.trim()) {
    fields.body = await service.translateText({
      text: sourceFields.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      sourceLanguage,
      targetLanguage: input.targetLanguage,
    });
  }

  const result = await upsertContentTranslation({
    content_id: article.id,
    language_code: input.targetLanguage,
    fields,
    source_type: "SYSTEM",
    status: "SYSTEM_GENERATED",
  });

  await setArticleStatus(input.contentId, input.applicationId, "REVIEW");
  revalidatePath(
    `/applications/${input.applicationId}/articles/${input.contentId}`
  );
  return result;
}

export async function autoTranslateArticleLanguages(input: {
  contentId: string;
  targetLanguages: string[];
  applicationId: string;
  sourceFields?: SourceContentFields;
  sourceLanguage?: string;
}): Promise<ContentTranslation[]> {
  await requireContentAccess(input.contentId, "edit");
  const article = await getArticle(input.contentId);
  if (!article) throw new Error("Article not found");
  const sourceLanguage = input.sourceLanguage?.trim() || article.source_language;
  const targets = normalizeTargetLanguages(input.targetLanguages, sourceLanguage);
  if (targets.length === 0) {
    throw new Error("Choose a language other than the source.");
  }
  await updateArticle(input.contentId, input.applicationId, {
    title: input.sourceFields?.title?.trim() || article.title,
    slug: null,
    content_type: article.content_type,
    source_language: sourceLanguage,
    source_content: input.sourceFields
      ? { ...article.source_content, ...input.sourceFields }
      : article.source_content,
    status: article.status,
    scheduled_publish_at: article.scheduled_publish_at,
    target_languages: targets,
  });
  const results: ContentTranslation[] = [];
  for (const targetLanguage of targets) {
    results.push(
      await autoTranslateArticle({
        contentId: input.contentId,
        targetLanguage,
        applicationId: input.applicationId,
        sourceFields: input.sourceFields,
        sourceLanguage,
      })
    );
  }
  return results;
}

export async function saveManualContentTranslation(input: {
  contentId: string;
  languageCode: string;
  fields: SourceContentFields;
  applicationId: string;
}): Promise<ContentTranslation> {
  await requireContentAccess(input.contentId, "edit");
  const db = await getDb();
  const { data: article, error: articleError } = await db
    .from("content")
    .select("status")
    .eq("id", input.contentId)
    .single();
  if (articleError) throw new Error(articleError.message);
  const { data: existing, error: existingError } = await db
    .from("content_translations")
    .select("updated_at")
    .eq("content_id", input.contentId)
    .eq("language_code", input.languageCode)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const result = await upsertContentTranslation({
    content_id: input.contentId,
    language_code: input.languageCode,
    fields: input.fields,
    source_type: "MANUAL",
    status: "MANUALLY_MODIFIED",
  });
  const changed = !existing || existing.updated_at !== result.updated_at;
  if (
    changed &&
    (article.status === "APPROVED" || article.status === "PUBLISHED")
  ) {
    await setArticleStatus(input.contentId, input.applicationId, "REVIEW");
  }
  revalidatePath(
    `/applications/${input.applicationId}/articles/${input.contentId}`
  );
  return result;
}

function emptyTranslationFields(): SourceContentFields {
  return {
    title: "",
    summary: "",
    body: "",
    seo_title: "",
    seo_description: "",
  };
}

function describeExportGaps(skipped: string[], blankCounts: Map<string, number>) {
  const parts: string[] = [];
  if (skipped.length > 0) {
    const label = skipped.length === 1 ? "article" : "articles";
    parts.push(
      `${skipped.length} ${label} skipped, no approved language: ${skipped.join(", ")}.`
    );
  }
  for (const [code, count] of blankCounts) {
    const label = count === 1 ? "article" : "articles";
    parts.push(`${code} left blank on ${count} ${label}, not approved.`);
  }
  return parts.join(" ");
}

export async function exportArticlesFile(input: {
  applicationId: string;
  contentIds: string[];
}): Promise<{ filename: string; base64: string; notice: string }> {
  await requireAppCapability(input.applicationId, "view");
  const ids = [...new Set(input.contentIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("Select at least one article.");
  if (ids.length > 200) throw new Error("Export up to 200 articles at a time.");

  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select("*, translations:content_translations(*)")
    .eq("application_id", input.applicationId)
    .in("id", ids);
  if (error) throw new Error(error.message);

  const byId = new Map(
    ((data ?? []) as Array<
      Content & { translations: ContentTranslation[] | null }
    >).map((row) => [row.id, row])
  );
  const skipped: string[] = [];
  const blankCounts = new Map<string, number>();
  const ordered = ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const article = mapContentRow(row);
    const source = article.source_language.trim().toLowerCase();
    const translations = row.translations ?? [];
    const approvedCodes = new Set(
      translations
        .filter(
          (translation) =>
            translation.status === "APPROVED" &&
            translation.language_code.trim().toLowerCase() !== source
        )
        .map((translation) => translation.language_code.trim().toLowerCase())
    );
    if (approvedCodes.size === 0) {
      skipped.push(article.title);
      return [];
    }

    const columnCodes = new Map<string, string>();
    for (const code of article.target_languages) {
      const key = code.trim().toLowerCase();
      if (!key || key === source || columnCodes.has(key)) continue;
      columnCodes.set(key, code);
    }
    for (const translation of translations) {
      const key = translation.language_code.trim().toLowerCase();
      if (!key || key === source || columnCodes.has(key)) continue;
      columnCodes.set(key, translation.language_code);
    }
    for (const [key, code] of columnCodes) {
      if (approvedCodes.has(key)) continue;
      blankCounts.set(code, (blankCounts.get(code) ?? 0) + 1);
    }

    const byLang = new Map(
      translations.map((translation) => [
        translation.language_code.trim().toLowerCase(),
        translation,
      ])
    );
    return [
      {
        title: article.title,
        source_language: article.source_language,
        content_type: article.content_type,
        status: article.status,
        source_content: article.source_content,
        target_languages: [...columnCodes.values()],
        translations: [...columnCodes.entries()].map(([key, code]) => {
          const translation = byLang.get(key);
          if (!translation || translation.status !== "APPROVED") {
            return { language_code: code, ...emptyTranslationFields() };
          }
          return {
            language_code: code,
            title: translation.title,
            summary: translation.summary,
            body: translation.body,
            seo_title: translation.seo_title,
            seo_description: translation.seo_description,
          };
        }),
      },
    ];
  });
  const notice = describeExportGaps(skipped, blankCounts);
  if (ordered.length === 0) {
    throw new Error(notice || "No matching articles to export.");
  }

  const { base64 } = buildArticleWorkbook(ordered);
  const day = new Date().toISOString().slice(0, 10);
  return { filename: `press-articles-${day}.xlsx`, base64, notice };
}

export async function getPressStats(applicationId: string) {
  await requireAppCapability(applicationId, "view");
  const db = await getDb();
  const statuses: ContentLifecycleStatus[] = [
    "DRAFT",
    "TRANSLATING",
    "REVIEW",
    "APPROVED",
    "PUBLISHED",
  ];
  const counts: Record<string, number> = { total: 0 };
  for (const status of statuses) {
    const { count, error } = await db
      .from("content")
      .select("*", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .eq("status", status);
    if (error) throw new Error(error.message);
    counts[status] = count ?? 0;
    counts.total += count ?? 0;
  }
  return {
    articles: counts.total,
    published: counts.PUBLISHED ?? 0,
    inReview: counts.REVIEW ?? 0,
    draft: counts.DRAFT ?? 0,
    translating: counts.TRANSLATING ?? 0,
    approved: counts.APPROVED ?? 0,
  };
}
