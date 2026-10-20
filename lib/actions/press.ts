"use server";

import { UserFacingError } from "@/lib/errors";
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
  capabilityForReleaseStatus,
  currentAppAccess,
  requireChosenMarket,
  requireAppCapability,
  requireContentAccess,
  requireContentTranslationAccess,
  requireContentVersionAccess,
  requireUser,
} from "@/lib/auth/access";
import { emptySourceContent, manualSaveStatus } from "@/lib/types";
import { getTranslationService } from "@/lib/translation/service";
import { applyGlossaryToTranslation } from "@/lib/translation-quality/glossary-fix";
import { normalizeSlug } from "@/lib/slug";
import { DUE_SOON_MS, type PublishDueKind } from "@/lib/publish-due";
import { requireContentTypeCode } from "@/lib/actions/content-types";
import { addArticleComment } from "@/lib/actions/comments";
import { languageKey, normalizeTargetLanguages } from "@/lib/target-languages";
import { normalizeMarket } from "@/lib/markets";
import { canSeeMarket, marketScope } from "@/lib/auth/business-units";
import { buildArticleWorkbook } from "@/lib/export/articles";
import { replaceArticlePublishTargets } from "@/lib/publish/store";
import { publishSchemaError } from "@/lib/publish/errors";
import { isProduction } from "@/lib/env";
import { syncArticlePublishStatus } from "@/lib/publish/run";
import { isPublishable, normalizeLanguageSchedule } from "@/lib/publish/schedule";
import {
  recordArticleEvent,
  recordArticleEvents,
  recordStatusChange,
  type ArticleAuditInput,
} from "@/lib/audit";

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
  await recordArticleEvents(
    (data ?? [])
      .filter((row) => ids.includes(row.id as string))
      .map((row) => ({
        contentId,
        event: "TRANSLATION_UNAPPROVED" as const,
        languageCode: String(row.language_code),
        fromStatus: "APPROVED",
        toStatus: "MANUALLY_MODIFIED",
        detail: { reason: "Source text changed" },
      }))
  );
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

/**
 * Approving a language can only raise the article to APPROVED, and taking an approval
 * away can only drop it to REVIEW, so an approval never sends the article backwards.
 */
async function syncArticleStatusFromApprovals(
  contentId: string,
  applicationId: string,
  direction: "promote" | "demote"
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
  if (direction === "promote" && allApproved && !isPublishable(data.status)) {
    await persistArticleStatus(contentId, applicationId, "APPROVED");
  } else if (direction === "demote" && !allApproved && data.status !== "DRAFT") {
    // A revoked language needs the editor's fix, so the article goes back to them.
    await persistArticleStatus(contentId, applicationId, "DRAFT");
  }
}

/** Approving the article approves every target language that already has a translation. */
async function approveTargetTranslations(
  contentId: string,
  sourceLanguage: string,
  targetLanguages: string[],
  userId: string
) {
  const targets = new Set(
    normalizeTargetLanguages(targetLanguages, sourceLanguage).map(languageKey)
  );
  if (targets.size === 0) return;
  const db = await getDb();
  const { data, error } = await db
    .from("content_translations")
    .select("id, language_code, status, title, summary, body")
    .eq("content_id", contentId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter(
    (row) =>
      row.status !== "APPROVED" &&
      targets.has(languageKey(String(row.language_code))) &&
      [row.title, row.summary, row.body].some((value) => String(value ?? "").trim())
  );
  if (rows.length === 0) return;
  const { error: updateError } = await db
    .from("content_translations")
    .update({ status: "APPROVED", ...(await approvalStamp("APPROVED", userId)) })
    .in(
      "id",
      rows.map((row) => row.id as string)
    );
  if (updateError) throw new Error(updateError.message);
  await recordArticleEvents(
    rows.map((row) => ({
      contentId,
      event: "TRANSLATION_APPROVED" as const,
      languageCode: String(row.language_code),
      fromStatus: String(row.status),
      toStatus: "APPROVED",
      detail: { reason: "Article approved" },
    }))
  );
}

function mapContentRow(data: Content): Content {
  return {
    ...data,
    slug: data.slug ?? null,
    scheduled_publish_at: data.scheduled_publish_at ?? null,
    language_publish_at: normalizeLanguageSchedule(data.language_publish_at),
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
  const grant = await requireAppCapability(input.applicationId, "view");
  const scope = marketScope(grant.access);
  const db = await getDb();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const now = new Date();
  const nowIso = now.toISOString();
  const soonIso = new Date(now.getTime() + DUE_SOON_MS).toISOString();

  const sourceLanguages = [
    ...new Set(
      (input.sourceLanguages ?? [])
        .map((code) => code.trim())
        .filter(Boolean)
    ),
  ];
  const market = normalizeMarket(input.market);

  /** The app's articles with the list filters applied. */
  function filtered(columns: string, head = false) {
    let query = db
      .from("content")
      .select(columns, head ? { count: "exact", head: true } : undefined)
      .eq("application_id", input.applicationId);

    if (scope) query = query.in("market", scope);
    if (input.status) query = query.eq("status", input.status);
    if (input.contentType) query = query.eq("content_type", input.contentType);
    if (sourceLanguages.length === 1) {
      query = query.eq("source_language", sourceLanguages[0]);
    } else if (sourceLanguages.length > 1) {
      query = query.in("source_language", sourceLanguages);
    }
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
    return query;
  }
  type ListQuery = ReturnType<typeof filtered>;

  // List order: review first, then due to publish (soonest first), then latest update.
  // Each group is queried on its own and the requested page is cut across them.
  const groups: { where: (q: ListQuery) => ListQuery; order: (q: ListQuery) => ListQuery }[] = [
    {
      where: (q) => q.eq("status", "REVIEW"),
      order: (q) =>
        q
          .order("scheduled_publish_at", { ascending: true, nullsFirst: false })
          .order("updated_at", { ascending: false }),
    },
    {
      where: (q) =>
        q.not("status", "in", "(REVIEW,PUBLISHED)").not("scheduled_publish_at", "is", null),
      order: (q) =>
        q
          .order("scheduled_publish_at", { ascending: true })
          .order("updated_at", { ascending: false }),
    },
    {
      where: (q) =>
        q.neq("status", "REVIEW").or("status.eq.PUBLISHED,scheduled_publish_at.is.null"),
      order: (q) => q.order("updated_at", { ascending: false }),
    },
  ];

  const counts = await Promise.all(
    groups.map(async (group) => {
      const { count, error } = await group.where(filtered("id", true));
      if (error) throw new Error(error.message);
      return count ?? 0;
    })
  );

  let start = 0;
  const slices = await Promise.all(
    groups.map(async (group, index) => {
      const groupStart = start;
      start += counts[index];
      const sliceFrom = Math.max(from, groupStart) - groupStart;
      const sliceTo = Math.min(to, groupStart + counts[index] - 1) - groupStart;
      if (sliceFrom > sliceTo) return [];
      const { data, error } = await group
        .order(
          group.where(
            filtered("*, translations:content_translations(id, language_code, status, title)")
          )
        )
        .order("id", { ascending: false })
        .range(sliceFrom, sliceTo);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ArticleListItem[];
    })
  );

  return {
    items: slices.flat().map((item) => ({
      ...mapContentRow(item),
      translations: item.translations ?? [],
    })),
    total: counts.reduce((sum, count) => sum + count, 0),
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
  // Only count applications this user can see, in their business units' markets.
  const accesses = await Promise.all(ids.map((id) => currentAppAccess(id)));
  const db = await getDb();
  const counts: Record<string, number> = {};
  await Promise.all(
    ids.map(async (id, index) => {
      const access = accesses[index];
      if (!access) return;
      const scope = marketScope(access);
      let query = db
        .from("content")
        .select("id", { count: "exact", head: true })
        .eq("status", "REVIEW")
        .eq("application_id", id);
      if (scope) query = query.in("market", scope);
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      if (count) counts[id] = count;
    })
  );
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
  const access = await currentAppAccess((data as Content).application_id);
  if (!access || !canSeeMarket(access, (data as Content).market)) return null;
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
  /** Keep DRAFT for an approver. Omitted saves from approvers are stored as approved. */
  keepAsDraft?: boolean;
  /** Store the given status as is, such as a status column in an import file. */
  keepStatus?: boolean;
}): Promise<Content> {
  const grant = await requireAppCapability(input.application_id, "edit");
  const market = requireChosenMarket(grant.access, input.market);
  let status: ContentLifecycleStatus = input.status ?? "DRAFT";
  if (input.keepAsDraft) {
    status = "DRAFT";
  } else if (!input.keepStatus && grant.access.can_approve && !isPublishable(status)) {
    status = "APPROVED";
  }
  if (isPublishable(status) && !grant.access.can_approve) {
    throw new UserFacingError("Your role cannot approve.");
  }
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
      content_type: await requireContentTypeCode(
        input.application_id,
        input.content_type
      ),
      title: input.title.trim(),
      slug:
        input.slug === null ? null : normalizeSlug(input.slug, input.title),
      source_language: input.source_language,
      source_content,
      status,
      target_languages,
      market,
      submitted_by_name: actor?.name ?? null,
      submitted_by_username: actor?.username ?? null,
      scheduled_publish_at: isProduction() ? null : input.scheduled_publish_at || null,
      ...publishTimestampPatch(status, null),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await recordArticleEvent({
    contentId: data.id,
    applicationId: input.application_id,
    title: data.title,
    event: "CREATED",
    toStatus: status,
    languageCode: input.source_language,
  });

  await upsertContentTranslation({
    content_id: data.id,
    language_code: input.source_language,
    fields: source_content,
    source_type: "MANUAL",
    status: isPublishable(status) ? "APPROVED" : "MANUALLY_MODIFIED",
  });

  revalidatePath(`/applications/${input.application_id}`);
  return mapContentRow(data as Content);
}

/** Create or update a new article, then store its translations. Draft never approves. */
export async function saveNewArticle(input: {
  applicationId: string;
  contentId?: string | null;
  title: string;
  contentType: string;
  sourceLanguage: string;
  sourceFields: SourceContentFields;
  market?: string | null;
  targetLanguages?: string[];
  scheduledPublishAt?: string | null;
  /** draft keeps it for later, review hands it to an approver, approve releases it. */
  mode: "draft" | "review" | "approve";
  translations?: Array<{
    languageCode: string;
    fields: SourceContentFields;
    origin: "system" | "manual";
    /** Approve this language on its own, as the editor's Approve button does. */
    approved?: boolean;
  }>;
}): Promise<{ id: string }> {
  const approve = input.mode === "approve";
  const unapprovedStatus: ContentLifecycleStatus =
    input.mode === "review" ? "REVIEW" : "DRAFT";
  if (approve) {
    await requireAppCapability(input.applicationId, "approve");
  }
  const sourceFields: SourceContentFields = {
    title: input.sourceFields.title?.trim() || input.title.trim(),
    summary: input.sourceFields.summary?.trim() ?? "",
    body: input.sourceFields.body ?? "",
    seo_title: input.sourceFields.seo_title?.trim() || input.title.trim(),
    seo_description:
      input.sourceFields.seo_description?.trim() ||
      input.sourceFields.summary?.trim() ||
      "",
  };
  const status: ContentLifecycleStatus = approve ? "APPROVED" : unapprovedStatus;
  let articleId = input.contentId?.trim() || "";
  if (!articleId) {
    const article = await createArticle({
      application_id: input.applicationId,
      title: input.title.trim() || sourceFields.title,
      slug: null,
      source_language: input.sourceLanguage,
      content_type: input.contentType,
      status,
      market: input.market ?? null,
      target_languages: input.targetLanguages,
      scheduled_publish_at: input.scheduledPublishAt ?? null,
      source_content: sourceFields,
      keepAsDraft: !approve,
    });
    articleId = article.id;
  } else {
    await updateArticle(articleId, input.applicationId, {
      title: input.title.trim() || sourceFields.title,
      slug: null,
      content_type: input.contentType,
      source_language: input.sourceLanguage,
      source_content: sourceFields,
      status,
      scheduled_publish_at: input.scheduledPublishAt ?? null,
      target_languages: input.targetLanguages,
      market: input.market ?? null,
      keepApprovals: true,
    });
  }

  if (!approve) {
    const db = await getDb();
    const { data: before, error: beforeError } = await db
      .from("content")
      .select("status, translations:content_translations(language_code, status)")
      .eq("id", articleId)
      .single();
    if (beforeError) throw new Error(beforeError.message);
    const { error } = await db
      .from("content")
      .update({ status: unapprovedStatus, published_at: null })
      .eq("id", articleId);
    if (error) throw new Error(error.message);
    await recordStatusChange(articleId, before.status, unapprovedStatus, {
      applicationId: input.applicationId,
    });
    const sourceWasApproved = (
      (before.translations ?? []) as { language_code: string; status: string }[]
    ).some(
      (row) =>
        row.status === "APPROVED" &&
        languageKey(row.language_code) === languageKey(input.sourceLanguage)
    );
    if (sourceWasApproved) {
      await recordArticleEvent({
        contentId: articleId,
        applicationId: input.applicationId,
        event: "TRANSLATION_UNAPPROVED",
        languageCode: input.sourceLanguage,
        fromStatus: "APPROVED",
        toStatus: "MANUALLY_MODIFIED",
        detail: { reason: `Saved as ${unapprovedStatus.toLowerCase()}` },
      });
    }
    const { error: sourceError } = await db
      .from("content_translations")
      .update({
        status: "MANUALLY_MODIFIED",
        approved_by_username: null,
        approved_by_name: null,
        approved_by_user_id: null,
        approved_at: null,
      })
      .eq("content_id", articleId)
      .eq("language_code", input.sourceLanguage);
    if (sourceError) throw new Error(sourceError.message);
  } else {
    await upsertContentTranslation({
      content_id: articleId,
      language_code: input.sourceLanguage,
      fields: sourceFields,
      source_type: "MANUAL",
      status: "APPROVED",
    });
  }

  for (const row of input.translations ?? []) {
    if (languageKey(row.languageCode) === languageKey(input.sourceLanguage)) continue;
    if (
      !row.fields.title.trim() &&
      !row.fields.summary.trim() &&
      !row.fields.body.trim()
    ) {
      continue;
    }
    await upsertContentTranslation({
      content_id: articleId,
      language_code: row.languageCode,
      fields: {
        ...row.fields,
        seo_title: row.fields.seo_title || row.fields.title,
        seo_description: row.fields.seo_description || row.fields.summary,
      },
      source_type: row.origin === "system" ? "SYSTEM" : "MANUAL",
      // Saving as approved checks the approve permission and records who approved it.
      status: approve || row.approved
        ? "APPROVED"
        : row.origin === "system"
          ? "SYSTEM_GENERATED"
          : "MANUALLY_MODIFIED",
    });
  }

  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(`/applications/${input.applicationId}/articles/${articleId}`);
  return { id: articleId };
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
    /** Language -> ISO time. Omitted leaves the per-language times unchanged. */
    language_publish_at?: Record<string, string>;
    target_languages?: string[];
    market?: string | null;
    /** Language and provider pairs. Omitted values leave the selection unchanged. */
    publish_targets?: { language_code: string; vendor_id: string }[];
    /** Adding a language must not clear other approvals or drop the article to review. */
    keepApprovals?: boolean;
  }
): Promise<Content> {
  const grant = await requireContentAccess(id, "edit");
  const db = await getDb();
  const { data: current, error: currentError } = await db
    .from("content")
    .select(
      "published_at, status, title, content_type, market, scheduled_publish_at, source_language, source_content, target_languages, submitted_by_name"
    )
    .eq("id", id)
    .single();
  if (currentError) throw new Error(currentError.message);

  const releasing = isPublishable(input.status);
  if (releasing && input.status !== current.status && !grant.access.can_approve) {
    throw new UserFacingError("Your role cannot approve.");
  }

  const textChanged = sourceContentChanged(
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

  if (textChanged && !input.keepApprovals) {
    await clearTargetApprovals(id, input.source_language);
  }

  const released = isPublishable(current.status);
  const markingReleased = isPublishable(input.status);
  let nextStatus = input.status;
  if (!input.keepApprovals && textChanged && (released || markingReleased)) {
    nextStatus = "REVIEW";
  }

  const patch: Record<string, unknown> = {
    title: input.title.trim(),
    slug: (input.slug ?? "").trim()
      ? normalizeSlug(input.slug, input.title)
      : null,
    content_type: await requireContentTypeCode(
      applicationId,
      input.content_type
    ),
    source_language: input.source_language,
    source_content: input.source_content,
    status: nextStatus,
    ...publishTimestampPatch(nextStatus, current.published_at),
  };
  // With publishing off, publish times and providers are left as they are.
  const canSetPublishing = !isProduction();
  if (canSetPublishing && input.scheduled_publish_at !== undefined) {
    patch.scheduled_publish_at = input.scheduled_publish_at || null;
  }
  if (canSetPublishing && input.language_publish_at !== undefined) {
    patch.language_publish_at = normalizeLanguageSchedule(input.language_publish_at);
  }
  if (input.target_languages !== undefined) {
    patch.target_languages = nextTargets;
  }
  if (input.market !== undefined && normalizeMarket(input.market) !== normalizeMarket(current.market)) {
    patch.market = requireChosenMarket(grant.access, input.market);
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
  if (error) throw publishSchemaError(error) ?? new Error(error.message);

  const changed: string[] = [];
  if (data.title !== current.title) changed.push("title");
  if (textChanged) changed.push("source text");
  if (data.source_language !== current.source_language) changed.push("source language");
  if (data.content_type !== current.content_type) changed.push("content type");
  if (targetsChanged) changed.push("target languages");
  if ((data.market ?? null) !== (current.market ?? null)) changed.push("market");
  if ((data.scheduled_publish_at ?? null) !== (current.scheduled_publish_at ?? null)) {
    changed.push("publish time");
  }
  const audit: ArticleAuditInput[] = [];
  if (changed.length > 0) {
    audit.push({
      contentId: id,
      applicationId,
      title: data.title,
      event: "EDITED",
      detail: {
        fields: changed,
        ...(targetsChanged ? { target_languages: { from: currentTargets, to: nextTargets } } : {}),
      },
    });
  }
  if (current.status !== nextStatus) {
    audit.push({
      contentId: id,
      applicationId,
      title: data.title,
      event: "STATUS_CHANGED",
      fromStatus: current.status,
      toStatus: nextStatus,
      ...(nextStatus !== input.status ? { detail: { reason: "Source text changed" } } : {}),
    });
  }
  await recordArticleEvents(audit);

  if (isPublishable(nextStatus) && !released && grant.access.can_approve) {
    await approveTargetTranslations(id, input.source_language, nextTargets, grant.user.id);
  }
  if (targetsChanged && !textChanged && !input.keepApprovals) {
    const allApproved = await targetsAllApproved(
      id,
      input.source_language,
      nextTargets
    );
    if (allApproved && !isPublishable(nextStatus)) {
      await persistArticleStatus(id, applicationId, "APPROVED");
    }
  }
  if (canSetPublishing && input.publish_targets !== undefined) {
    await replaceArticlePublishTargets(id, applicationId, input.publish_targets, [
      input.source_language,
      ...nextTargets,
    ]);
  }
  // A language ticked after the rest went live moves the article back to PUBLISHING.
  const resynced = isPublishable(nextStatus) && (await syncArticlePublishStatus(id));
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/articles/${id}`);
  if (resynced) {
    const { data: fresh } = await db.from("content").select("*").eq("id", id).single();
    if (fresh) return mapContentRow(fresh as Content);
  }
  return mapContentRow(data as Content);
}

async function persistArticleStatus(
  id: string,
  applicationId: string,
  status: ContentLifecycleStatus
): Promise<void> {
  const db = await getDb();
  const { data: current, error: currentError } = await db
    .from("content")
    .select("published_at, status")
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
  await recordStatusChange(id, current.status, status, { applicationId });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/articles/${id}`);
}

export async function setArticleStatus(
  id: string,
  applicationId: string,
  status: ContentLifecycleStatus
): Promise<void> {
  await requireContentAccess(id, capabilityForReleaseStatus(status));
  await persistArticleStatus(id, applicationId, status);
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
  const grant = await requireAppCapability(input.applicationId, "edit");
  const ids = [...new Set(input.contentIds.filter(Boolean))];
  if (ids.length === 0) return { deleted: 0 };

  const db = await getDb();
  const scope = marketScope(grant.access);
  let remove = db
    .from("content")
    .delete()
    .eq("application_id", input.applicationId)
    .in("id", ids);
  if (scope) remove = remove.in("market", scope);
  const { data, error } = await remove.select("id, title, status");
  if (error) throw new Error(error.message);
  await recordArticleEvents(
    (data ?? []).map((row) => ({
      contentId: String(row.id),
      applicationId: input.applicationId,
      title: String(row.title ?? ""),
      event: "DELETED" as const,
      fromStatus: String(row.status),
    }))
  );

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

  const approval =
    status === "APPROVED"
      ? await approvalStamp("APPROVED", grant.user.id)
      : {
          approved_by_username: null,
          approved_by_name: null,
          approved_by_user_id: null,
          approved_at: null,
        };
  const payload = {
    title: input.fields.title,
    summary: input.fields.summary,
    body: input.fields.body,
    seo_title: input.fields.seo_title,
    seo_description: input.fields.seo_description,
    status,
    ...approval,
  };

  const textChanged =
    !existing ||
    existing.title !== payload.title ||
    existing.summary !== payload.summary ||
    existing.body !== payload.body ||
    existing.seo_title !== payload.seo_title ||
    existing.seo_description !== payload.seo_description;

  let translation: ContentTranslation;
  if (existing) {
    const unchanged = !textChanged && existing.status === payload.status;
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

  const previousStatus = (existing?.status as string | undefined) ?? null;
  const audit: ArticleAuditInput[] = [];
  if (textChanged) {
    audit.push({
      contentId: input.content_id,
      event: "TRANSLATION_SAVED",
      languageCode: input.language_code,
      fromStatus: previousStatus,
      toStatus: status,
      detail: { version: versionNumber, source_type: input.source_type },
    });
  }
  const approvalEvent = approvalChange(previousStatus, status);
  if (approvalEvent) {
    audit.push({
      contentId: input.content_id,
      event: approvalEvent,
      languageCode: input.language_code,
      fromStatus: previousStatus,
      toStatus: status,
    });
  }
  await recordArticleEvents(audit);

  return translation;
}

function approvalChange(
  from: string | null,
  to: string
): "TRANSLATION_APPROVED" | "TRANSLATION_UNAPPROVED" | null {
  if (to === "APPROVED" && from !== "APPROVED") return "TRANSLATION_APPROVED";
  if (from === "APPROVED" && to !== "APPROVED") return "TRANSLATION_UNAPPROVED";
  return null;
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
  const { data: version, error: findError } = await db
    .from("content_translation_versions")
    .select("version_number, translation:content_translations(content_id, language_code)")
    .eq("id", input.versionId)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  const { error } = await db
    .from("content_translation_versions")
    .delete()
    .eq("id", input.versionId);
  if (error) throw new Error(error.message);
  const owner = version?.translation as
    | { content_id: string; language_code: string }
    | { content_id: string; language_code: string }[]
    | null
    | undefined;
  const translation = Array.isArray(owner) ? owner[0] : owner;
  if (translation) {
    await recordArticleEvent({
      contentId: translation.content_id,
      event: "EDITED",
      languageCode: translation.language_code,
      detail: { action: "Version deleted", version: version?.version_number ?? null },
    });
  }
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
  /** Revoking only: posted as a comment on that language for the editor. */
  reason?: string;
}): Promise<void> {
  const grant = await requireContentTranslationAccess(
    input.contentTranslationId,
    input.status === "APPROVED" ? "approve" : "edit"
  );
  const db = await getDb();
  const { data: before, error: beforeError } = await db
    .from("content_translations")
    .select("content_id, language_code, status")
    .eq("id", input.contentTranslationId)
    .single();
  if (beforeError) throw new Error(beforeError.message);
  // Revoking an approval is an approver's call, same as granting one.
  if (before.status === "APPROVED" && input.status !== "APPROVED") {
    await requireContentTranslationAccess(input.contentTranslationId, "approve");
    const reason = input.reason?.trim();
    // Posted first so a rejected comment leaves the approval untouched.
    if (reason) {
      await addArticleComment({
        contentId: before.content_id,
        applicationId: input.applicationId,
        languageCode: before.language_code,
        body: `Approval revoked: ${reason}`,
      });
    }
  }
  const approval = await approvalStamp(input.status, grant.user.id);
  const { error } = await db
    .from("content_translations")
    .update({ status: input.status, ...approval })
    .eq("id", input.contentTranslationId);
  if (error) throw new Error(error.message);
  const approvalEvent = approvalChange(before.status, input.status);
  if (approvalEvent) {
    await recordArticleEvent({
      contentId: before.content_id,
      applicationId: input.applicationId,
      event: approvalEvent,
      languageCode: before.language_code,
      fromStatus: before.status,
      toStatus: input.status,
    });
  }
  await syncArticleStatusFromApprovals(
    input.contentId,
    input.applicationId,
    input.status === "APPROVED" ? "promote" : "demote"
  );
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
  /** Approver import: store the translation as approved and leave the article status alone. */
  approveTranslation?: boolean;
}): Promise<ContentTranslation> {
  const grant = await requireContentAccess(input.contentId, "edit");
  const article = await getArticle(input.contentId);
  if (!article) throw new UserFacingError("Article not found");

  const sourceLanguage =
    input.sourceLanguage?.trim() || article.source_language;
  if (languageKey(sourceLanguage) === languageKey(input.targetLanguage)) {
    throw new UserFacingError("Target language must differ from source language.");
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
      status: article.status,
      scheduled_publish_at: article.scheduled_publish_at,
      target_languages: normalizeTargetLanguages(
        article.target_languages,
        sourceLanguage
      ),
      keepApprovals: true,
    });
  }

  const service = getTranslationService(grant.applicationId);
  const translated = await service.translateArticle({
    fields: sourceFields,
    sourceLanguage,
    targetLanguage: input.targetLanguage,
  });

  if (!translated.body?.trim() && sourceFields.body?.trim()) {
    translated.body = await service.translateText({
      text: sourceFields.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      sourceLanguage,
      targetLanguage: input.targetLanguage,
    });
  }
  // Glossary spellings are fixed before saving, so nobody has to accept them one by one.
  const fields = await applyGlossaryToTranslation({
    applicationId: grant.applicationId,
    sourceLanguage,
    targetLanguage: input.targetLanguage,
    source: sourceFields,
    translated,
  });

  const result = await upsertContentTranslation({
    content_id: article.id,
    language_code: input.targetLanguage,
    fields,
    source_type: "SYSTEM",
    status: input.approveTranslation ? "APPROVED" : "SYSTEM_GENERATED",
  });

  // AI translation never moves the article. The person edits it, then saves or submits.
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
  /**
   * Approver import: approve each generated translation and keep the article approved.
   * Off unless asked for: machine translations are saved as AI translated, for everyone,
   * and an approver approves them with the Approve button like any other draft.
   */
  approveTranslations?: boolean;
}): Promise<ContentTranslation[]> {
  await requireContentAccess(input.contentId, "edit");
  const approveTranslations = input.approveTranslations ?? false;
  const article = await getArticle(input.contentId);
  if (!article) throw new UserFacingError("Article not found");
  const sourceLanguage = input.sourceLanguage?.trim() || article.source_language;
  const requested = normalizeTargetLanguages(
    input.targetLanguages,
    sourceLanguage
  );
  if (requested.length === 0) {
    throw new UserFacingError("Choose a language other than the source.");
  }
  const approved = new Set(
    (article.translations ?? [])
      .filter((row) => row.status === "APPROVED")
      .map((row) => languageKey(row.language_code))
  );
  const toTranslate = requested.filter((code) => !approved.has(languageKey(code)));
  if (toTranslate.length === 0) {
    throw new UserFacingError("Selected languages are already approved.");
  }
  const storedTargets = normalizeTargetLanguages(
    [...(article.target_languages ?? []), ...requested],
    sourceLanguage
  );
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
    target_languages: storedTargets,
    keepApprovals: true,
  });
  const results: ContentTranslation[] = [];
  for (const targetLanguage of toTranslate) {
    results.push(
      await autoTranslateArticle({
        contentId: input.contentId,
        targetLanguage,
        applicationId: input.applicationId,
        sourceFields: input.sourceFields,
        sourceLanguage,
        approveTranslation: approveTranslations,
      })
    );
  }
  if (approveTranslations) {
    await syncArticleStatusFromApprovals(input.contentId, input.applicationId, "promote");
  }
  return results;
}

/** Translate into the selected languages without creating or updating an article. */
export async function previewTranslateArticle(input: {
  applicationId: string;
  sourceLanguage: string;
  targetLanguages: string[];
  sourceFields: SourceContentFields;
}): Promise<{ language_code: string; fields: SourceContentFields }[]> {
  await requireAppCapability(input.applicationId, "edit");
  const sourceLanguage = input.sourceLanguage.trim();
  const sourceFields: SourceContentFields = {
    title: input.sourceFields.title?.trim() ?? "",
    summary: input.sourceFields.summary?.trim() ?? "",
    body: input.sourceFields.body ?? "",
    seo_title:
      input.sourceFields.seo_title?.trim() || input.sourceFields.title?.trim() || "",
    seo_description:
      input.sourceFields.seo_description?.trim() ||
      input.sourceFields.summary?.trim() ||
      "",
  };
  if (!sourceFields.body.trim() && !sourceFields.title.trim()) {
    throw new UserFacingError("Nothing to translate — add a source title or body first.");
  }
  const requested = normalizeTargetLanguages(input.targetLanguages, sourceLanguage);
  if (requested.length === 0) {
    throw new UserFacingError("Choose a language other than the source.");
  }
  const service = getTranslationService(input.applicationId);
  const results: { language_code: string; fields: SourceContentFields }[] = [];
  for (const targetLanguage of requested) {
    let fields = await service.translateArticle({
      fields: sourceFields,
      sourceLanguage,
      targetLanguage,
    });
    if (!fields.body?.trim() && sourceFields.body.trim()) {
      fields = {
        ...fields,
        body: await service.translateText({
          text: sourceFields.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          sourceLanguage,
          targetLanguage,
        }),
      };
    }
    fields = await applyGlossaryToTranslation({
      applicationId: input.applicationId,
      sourceLanguage,
      targetLanguage,
      source: sourceFields,
      translated: fields,
    });
    results.push({ language_code: targetLanguage, fields });
  }
  return results;
}

export async function saveManualContentTranslation(input: {
  contentId: string;
  languageCode: string;
  fields: SourceContentFields;
  applicationId: string;
}): Promise<ContentTranslation> {
  const grant = await requireContentAccess(input.contentId, "edit");
  const approver = grant.access.can_approve;
  const db = await getDb();
  const { data: article, error: articleError } = await db
    .from("content")
    .select("status")
    .eq("id", input.contentId)
    .single();
  if (articleError) throw new Error(articleError.message);
  const { data: existing, error: existingError } = await db
    .from("content_translations")
    .select("updated_at, status")
    .eq("content_id", input.contentId)
    .eq("language_code", input.languageCode)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const result = await upsertContentTranslation({
    content_id: input.contentId,
    language_code: input.languageCode,
    fields: input.fields,
    source_type: "MANUAL",
    status: manualSaveStatus(approver, existing?.status as TranslationStatus | undefined),
  });
  const changed = !existing || existing.updated_at !== result.updated_at;
  if (
    !approver &&
    changed &&
    isPublishable(article.status)
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

function listTitles(titles: string[], max = 5) {
  const quoted = titles.slice(0, max).map((title) => `“${title || "Untitled"}”`);
  const rest = titles.length - quoted.length;
  return rest > 0 ? `${quoted.join(", ")} and ${rest} more` : quoted.join(", ");
}

function describeExportGaps(
  skipped: string[],
  blankCounts: Map<string, number>,
  exportedCount: number
) {
  const parts: string[] = [];
  if (skipped.length > 0 && exportedCount === 0) {
    parts.push(
      skipped.length === 1
        ? `There's nothing to export yet. ${listTitles(skipped)} doesn't have an approved translation. Approve at least one translation, then try again.`
        : "There's nothing to export yet. None of the selected articles have an approved translation. Approve at least one translation, then try again."
    );
  } else if (skipped.length > 0) {
    parts.push(
      skipped.length === 1
        ? `${listTitles(skipped)} wasn't included because it doesn't have an approved translation yet.`
        : `${skipped.length} articles weren't included because they don't have an approved translation yet: ${listTitles(skipped)}.`
    );
  }
  if (blankCounts.size > 0) {
    const languages = [...blankCounts]
      .map(([code, count]) => `${code} (${count} ${count === 1 ? "article" : "articles"})`)
      .join(", ");
    parts.push(
      `Some translations are still waiting for approval, so these language columns were left empty: ${languages}.`
    );
  }
  return parts.join(" ");
}

export async function exportArticlesFile(input: {
  applicationId: string;
  contentIds: string[];
}): Promise<{ filename: string; base64: string; notice: string }> {
  const grant = await requireAppCapability(input.applicationId, "view");
  const scope = marketScope(grant.access);
  const ids = [...new Set(input.contentIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new UserFacingError("Select at least one article.");
  if (ids.length > 200) throw new UserFacingError("Export up to 200 articles at a time.");

  const db = await getDb();
  let query = db
    .from("content")
    .select("*, translations:content_translations(*)")
    .eq("application_id", input.applicationId)
    .in("id", ids);
  if (scope) query = query.in("market", scope);
  const { data, error } = await query;
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
        market: article.market ?? "",
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
  const notice = describeExportGaps(skipped, blankCounts, ordered.length);
  if (ordered.length === 0) {
    return {
      filename: "",
      base64: "",
      notice: notice || "We couldn't find the selected articles. They may have been deleted. Refresh the page and try again.",
    };
  }

  const { base64 } = buildArticleWorkbook(ordered);
  const day = new Date().toISOString().slice(0, 10);
  return { filename: `press-articles-${day}.xlsx`, base64, notice };
}

export async function getPressStats(applicationId: string) {
  const grant = await requireAppCapability(applicationId, "view");
  const scope = marketScope(grant.access);
  const db = await getDb();
  const statuses: ContentLifecycleStatus[] = [
    "DRAFT",
    "REVIEW",
    "APPROVED",
    "PUBLISHING",
    "PUBLISHED",
  ];
  const results = await Promise.all(
    statuses.map((status) => {
      let query = db
        .from("content")
        .select("id", { count: "exact", head: true })
        .eq("application_id", applicationId)
        .eq("status", status);
      if (scope) query = query.in("market", scope);
      return query;
    })
  );
  const counts: Record<string, number> = { total: 0 };
  results.forEach(({ count, error }, index) => {
    if (error) throw new Error(error.message);
    counts[statuses[index]] = count ?? 0;
    counts.total += count ?? 0;
  });
  return {
    articles: counts.total,
    published: counts.PUBLISHED ?? 0,
    inReview: counts.REVIEW ?? 0,
    draft: counts.DRAFT ?? 0,
    approved: counts.APPROVED ?? 0,
    publishing: counts.PUBLISHING ?? 0,
  };
}
