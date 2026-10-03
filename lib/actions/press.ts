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
import { approvalStamp, versionAuthorFields } from "@/lib/auth/actor";
import { emptySourceContent } from "@/lib/types";
import { getTranslationService } from "@/lib/translation/service";
import { normalizeSlug } from "@/lib/slug";
import { DUE_SOON_MS, type PublishDueKind } from "@/lib/publish-due";
import { normalizeTargetLanguages } from "@/lib/target-languages";
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
  due?: PublishDueKind;
}): Promise<Paginated<ArticleListItem>> {
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
}): Promise<Content> {
  const db = await getDb();
  const status = input.status ?? "DRAFT";
  const source_content = {
    ...emptySourceContent(),
    ...input.source_content,
    title: input.source_content.title || input.title,
  };
  const target_languages = normalizeTargetLanguages(
    input.target_languages,
    input.source_language
  );
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
  }
): Promise<Content> {
  const db = await getDb();
  const { data: current, error: currentError } = await db
    .from("content")
    .select("published_at")
    .eq("id", id)
    .single();
  if (currentError) throw new Error(currentError.message);

  const patch: Record<string, unknown> = {
    title: input.title.trim(),
    slug: (input.slug ?? "").trim()
      ? normalizeSlug(input.slug, input.title)
      : null,
    content_type: input.content_type,
    source_language: input.source_language,
    source_content: input.source_content,
    status: input.status,
    ...publishTimestampPatch(input.status, current.published_at),
  };
  if (input.scheduled_publish_at !== undefined) {
    patch.scheduled_publish_at = input.scheduled_publish_at || null;
  }
  if (input.target_languages !== undefined) {
    patch.target_languages = normalizeTargetLanguages(
      input.target_languages,
      input.source_language
    );
  }

  const { data, error } = await db
    .from("content")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/articles/${id}`);
  return mapContentRow(data as Content);
}

export async function setArticleStatus(
  id: string,
  applicationId: string,
  status: ContentLifecycleStatus
): Promise<void> {
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
  const db = await getDb();
  const status: TranslationStatus =
    input.status ??
    (input.source_type === "MANUAL"
      ? "MANUALLY_MODIFIED"
      : input.source_type === "SYSTEM"
        ? "SYSTEM_GENERATED"
        : "MANUALLY_MODIFIED");

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
      ...actorFields,
    });
  if (versionError) throw new Error(versionError.message);

  return translation;
}

export async function listContentTranslationVersions(
  contentTranslationId: string
): Promise<ContentTranslationVersion[]> {
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
  const db = await getDb();
  const approval = await approvalStamp(input.status);
  const { error } = await db
    .from("content_translations")
    .update({ status: input.status, ...approval })
    .eq("id", input.contentTranslationId);
  if (error) throw new Error(error.message);
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
  const article = await getArticle(input.contentId);
  if (!article) throw new Error("Article not found");

  const sourceLanguage =
    input.sourceLanguage?.trim() || article.source_language;
  if (sourceLanguage === input.targetLanguage) {
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
      target_languages: (article.target_languages ?? []).filter(
        (code) => code !== sourceLanguage
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
  const results: ContentTranslation[] = [];
  for (const targetLanguage of input.targetLanguages) {
    results.push(
      await autoTranslateArticle({
        contentId: input.contentId,
        targetLanguage,
        applicationId: input.applicationId,
        sourceFields: input.sourceFields,
        sourceLanguage: input.sourceLanguage,
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
  const result = await upsertContentTranslation({
    content_id: input.contentId,
    language_code: input.languageCode,
    fields: input.fields,
    source_type: "MANUAL",
    status: "MANUALLY_MODIFIED",
  });
  revalidatePath(
    `/applications/${input.applicationId}/articles/${input.contentId}`
  );
  return result;
}

export async function exportArticlesFile(input: {
  applicationId: string;
  contentIds: string[];
}): Promise<{ filename: string; base64: string }> {
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
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => {
      const article = mapContentRow(row);
      return {
        title: article.title,
        source_language: article.source_language,
        content_type: article.content_type,
        status: article.status,
        source_content: article.source_content,
        target_languages: article.target_languages,
        translations: (row.translations ?? []).map((translation) => ({
          language_code: translation.language_code,
          title: translation.title,
          summary: translation.summary,
          body: translation.body,
          seo_title: translation.seo_title,
          seo_description: translation.seo_description,
        })),
      };
    });
  if (ordered.length === 0) throw new Error("No matching articles to export.");

  const { base64 } = buildArticleWorkbook(ordered);
  const day = new Date().toISOString().slice(0, 10);
  return { filename: `press-articles-${day}.xlsx`, base64 };
}

export async function getPressStats(applicationId: string) {
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
