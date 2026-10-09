import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { throwPublishError } from "@/lib/publish/errors";
import { deliverToVendor, publicationInFlight } from "@/lib/publish/deliver";
import type { PublishArticle } from "@/lib/publish/integrations/integration";
import type { SourceContentFields } from "@/lib/types";
import { isDue, isPublishable, languagePublishAt, nextPublishStatus } from "@/lib/publish/schedule";
import { languageKey } from "@/lib/target-languages";

export type PublishRunResult = {
  due: number;
  delivered: number;
  failed: number;
  skipped: number;
  notes: string[];
};

type DueArticle = {
  id: string;
  application_id: string;
  title: string;
  slug: string | null;
  content_type: string;
  source_language: string;
  source_content: unknown;
  market: string | null;
  status: string;
  scheduled_publish_at: string | null;
  language_publish_at: Record<string, string> | null;
  target_languages: string[] | null;
};

type TranslationRow = {
  content_id: string;
  language_code: string;
  title: string;
  summary: string;
  body: string;
  seo_title: string;
  seo_description: string;
  status: string;
};

const BATCH = 25;

export async function runDuePublications(applicationId?: string): Promise<PublishRunResult> {
  const result: PublishRunResult = { due: 0, delivered: 0, failed: 0, skipped: 0, notes: [] };
  const nowIso = new Date().toISOString();
  const db = await getDb();

  const columns =
    "id, application_id, title, slug, content_type, source_language, source_content, market, status, scheduled_publish_at, language_publish_at, target_languages, content_publish_targets!inner(vendor_id, language_code)";
  type QueueRow = DueArticle & {
    content_publish_targets: { vendor_id: string; language_code: string }[];
  };

  /** Articles whose default time has passed, or that have a time per language to check. */
  async function loadQueue(
    status: "APPROVED" | "PUBLISHING" | "PUBLISHED",
    recentFirst: boolean,
    perLanguage: boolean
  ) {
    let query = db.from("content").select(columns).eq("status", status);
    query = perLanguage
      ? query.neq("language_publish_at", "{}")
      : query.not("scheduled_publish_at", "is", null).lte("scheduled_publish_at", nowIso);
    query = query
      .order(recentFirst ? "updated_at" : "scheduled_publish_at", { ascending: !recentFirst })
      .limit(BATCH);
    if (applicationId) query = query.eq("application_id", applicationId);
    const { data, error } = await query;
    if (error) throwPublishError(error);
    return (data ?? []) as QueueRow[];
  }

  const queues = await Promise.all([
    loadQueue("APPROVED", false, false),
    loadQueue("APPROVED", false, true),
    loadQueue("PUBLISHING", false, false),
    loadQueue("PUBLISHING", false, true),
    // Articles published before PUBLISHING existed can still have a language ticked later.
    loadQueue("PUBLISHED", true, false),
  ]);
  const byId = new Map<string, QueueRow>();
  for (const row of queues.flat()) if (!byId.has(row.id)) byId.set(row.id, row);
  const now = Date.now();
  // Keep only targets whose own time (or the article default) has passed.
  const targets = [...byId.values()].flatMap((article) => {
    const nested = article.content_publish_targets;
    const rows = Array.isArray(nested) ? nested : nested ? [nested] : [];
    return rows
      .filter((row) => isDue(languagePublishAt(article, row.language_code), now))
      .map((row) => ({
        content_id: article.id,
        vendor_id: row.vendor_id,
        language_code: row.language_code,
      }));
  });
  const dueIds = new Set(targets.map((row) => row.content_id));
  const dueArticles = [...byId.values()].filter((article) => dueIds.has(article.id));

  if (dueArticles.length === 0) {
    result.notes.push(
      "No approved articles with a language assigned to a provider are due. Approve the article, choose a provider for each language, and set its publish time to now or earlier."
    );
    return result;
  }

  const ids = dueArticles.map((article) => article.id);
  const [{ data: translations, error: translationsError }, { data: publications, error: publicationsError }] =
    await Promise.all([
      db
        .from("content_translations")
        .select("content_id, language_code, title, summary, body, seo_title, seo_description, status")
        .in("content_id", ids),
      db
        .from("content_publications")
        .select("id, content_id, vendor_id, language_code, status, external_url, attempted_at")
        .in("content_id", ids),
    ]);
  if (translationsError) throw new Error(translationsError.message);
  if (publicationsError) throwPublishError(publicationsError);

  const vendorIds = [...new Set(targets.map((row) => String(row.vendor_id)))];
  const vendorsById = new Map<string, VendorRecord>();
  if (vendorIds.length > 0) {
    const { data: vendors, error: vendorsError } = await db
      .from("publish_vendors")
      .select("id, application_id, name, type_code, config, status")
      .in("id", vendorIds);
    if (vendorsError) throwPublishError(vendorsError);
    for (const vendor of (vendors ?? []) as VendorRecord[]) vendorsById.set(vendor.id, vendor);
  }

  const touchedApps = new Set<string>();
  for (const article of dueArticles) {
    const articleTargets = targets.filter((row) => row.content_id === article.id);
    const articleTranslations = ((translations ?? []) as TranslationRow[]).filter(
      (row) => row.content_id === article.id
    );
    await publishArticleTargets(
      article,
      articleTargets,
      articleTranslations,
      publications,
      vendorsById,
      result,
      touchedApps
    );
  }

  for (const id of touchedApps) {
    try {
      revalidatePath(`/applications/${id}`);
      revalidatePath(`/applications/${id}/articles`);
    } catch {
      // The timer has no request store. The rows are already saved.
    }
  }
  if (result.due === 0 && result.notes.length === 0) {
    result.notes.push(
      "No approved articles with a language assigned to a provider are due. Approve the article, choose a provider for each language, and set its publish time to now or earlier."
    );
  }
  return result;
}

/** Sends one article's ticked languages now. The publish time is not required. */
export async function publishContentNow(contentId: string): Promise<PublishRunResult> {
  const result: PublishRunResult = { due: 0, delivered: 0, failed: 0, skipped: 0, notes: [] };
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select(
      "id, application_id, title, slug, content_type, source_language, source_content, market, status, scheduled_publish_at, language_publish_at, target_languages"
    )
    .eq("id", contentId)
    .single();
  if (error) throw new Error(error.message);
  const article = data as DueArticle;

  const { data: targetRows, error: targetsError } = await db
    .from("content_publish_targets")
    .select("vendor_id, language_code")
    .eq("content_id", contentId);
  if (targetsError) throwPublishError(targetsError);
  const articleTargets = (targetRows ?? []) as { vendor_id: string; language_code: string }[];

  const [{ data: translations, error: translationsError }, { data: publications, error: publicationsError }] =
    await Promise.all([
      db
        .from("content_translations")
        .select("content_id, language_code, title, summary, body, seo_title, seo_description, status")
        .eq("content_id", contentId),
      db
        .from("content_publications")
        .select("id, content_id, vendor_id, language_code, status, external_url, attempted_at")
        .eq("content_id", contentId),
    ]);
  if (translationsError) throw new Error(translationsError.message);
  if (publicationsError) throwPublishError(publicationsError);

  const vendorIds = [...new Set(articleTargets.map((row) => String(row.vendor_id)))];
  const vendorsById = new Map<string, VendorRecord>();
  if (vendorIds.length > 0) {
    const { data: vendors, error: vendorsError } = await db
      .from("publish_vendors")
      .select("id, application_id, name, type_code, config, status")
      .in("id", vendorIds);
    if (vendorsError) throwPublishError(vendorsError);
    for (const vendor of (vendors ?? []) as VendorRecord[]) vendorsById.set(vendor.id, vendor);
  }

  const touchedApps = new Set<string>();
  await publishArticleTargets(
    article,
    articleTargets,
    (translations ?? []) as TranslationRow[],
    publications,
    vendorsById,
    result,
    touchedApps
  );
  for (const id of touchedApps) {
    revalidatePath(`/applications/${id}`);
    revalidatePath(`/applications/${id}/articles`);
    revalidatePath(`/applications/${id}/articles/${contentId}`);
  }
  return result;
}

async function publishArticleTargets(
  article: DueArticle,
  articleTargets: { vendor_id: string; language_code: string }[],
  articleTranslations: TranslationRow[],
  publications: Parameters<typeof findPublication>[0],
  vendorsById: Map<string, VendorRecord>,
  result: PublishRunResult,
  touchedApps: Set<string>
) {
  const activeTargets = assignmentsFor(articleTargets, article.application_id, vendorsById);
  const unfinished = activeTargets.filter((target) => {
    const existing = findPublication(publications, article.id, target.vendor.id, target.languageCode);
    return existing?.status !== "PUBLISHED";
  });
  if (activeTargets.length > 0 && unfinished.length === 0) {
    if (await syncArticlePublishStatus(article.id)) touchedApps.add(article.application_id);
    return;
  }
  result.due += 1;
  if (!isPublishable(article.status)) {
    result.skipped += 1;
    note(result, `${article.title}: the article is not approved.`);
    return;
  }
  if (activeTargets.length === 0) {
    result.skipped += 1;
    note(result, `${article.title}: no active provider is selected.`);
    return;
  }

  for (const target of activeTargets) {
    const vendor = target.vendor;
    const existing = findPublication(publications, article.id, vendor.id, target.languageCode);
    if (existing?.status === "PUBLISHED") continue;
    const block = languageBlock(article, articleTranslations, target.languageCode);
    if (block) {
      result.skipped += 1;
      note(result, `${article.title}: ${block}`);
      continue;
    }
    if (existing?.status === "PENDING" && publicationInFlight(existing.attempted_at ?? null)) {
      result.skipped += 1;
      note(result, `${article.title}: ${target.languageCode} to ${vendor.name} is already publishing.`);
      continue;
    }

    const publicationId = await claimPublication(
      article.id,
      vendor.id,
      target.languageCode,
      existing?.id
    );
    const delivery = await deliverToVendor({
      id: vendor.id,
      name: vendor.name,
      typeCode: vendor.type_code,
      config: vendor.config,
      article: toPublishArticle(article, articleTranslations, target.languageCode, publicationId),
    });
    touchedApps.add(article.application_id);
    if (delivery.ok) {
      await savePublication(publicationId, {
        status: "PUBLISHED",
        external_url: delivery.externalUrl,
        error_message: null,
        published_at: new Date().toISOString(),
      });
      result.delivered += 1;
    } else {
      await savePublication(publicationId, {
        status: "FAILED",
        external_url: null,
        error_message: delivery.error,
        published_at: null,
      });
      result.failed += 1;
      note(result, `${article.title}: ${target.languageCode} to ${vendor.name} failed. ${delivery.error}`);
    }
  }

  if (await syncArticlePublishStatus(article.id)) touchedApps.add(article.application_id);
}

type VendorRecord = {
  id: string;
  application_id: string;
  name: string;
  type_code: string;
  config: unknown;
  status: string;
};

type LanguageAssignment = {
  vendor: VendorRecord;
  languageCode: string;
};

function assignmentsFor(
  rows: { vendor_id: string; language_code: string }[],
  applicationId: string,
  vendorsById: Map<string, VendorRecord>
): LanguageAssignment[] {
  const assignments: LanguageAssignment[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const vendor = vendorsById.get(String(row.vendor_id));
    const languageCode = String(row.language_code ?? "").trim();
    if (!vendor || !languageCode) continue;
    if (vendor.status !== "ACTIVE" || vendor.application_id !== applicationId) continue;
    const key = `${vendor.id}:${languageKey(languageCode)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({ vendor, languageCode });
  }
  return assignments;
}

function findPublication(
  publications: readonly {
    id?: string;
    content_id?: string;
    vendor_id?: string;
    language_code?: string;
    status?: string;
    attempted_at?: string | null;
  }[] | null,
  contentId: string,
  vendorId: string,
  languageCode: string
) {
  return (publications ?? []).find(
    (row) =>
      row.content_id === contentId &&
      row.vendor_id === vendorId &&
      languageKey(String(row.language_code ?? "")) === languageKey(languageCode)
  );
}

function languageBlock(article: DueArticle, translations: TranslationRow[], languageCode: string) {
  if (languageKey(languageCode) === languageKey(article.source_language)) return null;
  const row = translations.find(
    (item) => languageKey(item.language_code) === languageKey(languageCode)
  );
  if (!row || row.status !== "APPROVED") return `${languageCode} is not approved.`;
  return null;
}

function asFields(value: unknown): SourceContentFields {
  const row = (value ?? {}) as Partial<SourceContentFields>;
  return {
    title: row.title ?? "",
    summary: row.summary ?? "",
    body: row.body ?? "",
    seo_title: row.seo_title ?? "",
    seo_description: row.seo_description ?? "",
  };
}

function toPublishArticle(
  article: DueArticle,
  translations: TranslationRow[],
  languageCode: string,
  deliveryId: string
): PublishArticle {
  const shared = {
    deliveryId,
    id: article.id,
    slug: article.slug,
    market: article.market,
    contentType: article.content_type,
    translations: [] as PublishArticle["translations"],
  };
  if (languageKey(languageCode) === languageKey(article.source_language)) {
    const source = asFields(article.source_content);
    return {
      ...shared,
      title: source.title || article.title,
      summary: source.summary,
      html: source.body,
      seoTitle: source.seo_title,
      seoDescription: source.seo_description,
      languageCode: article.source_language,
    };
  }
  const row = translations.find(
    (item) => languageKey(item.language_code) === languageKey(languageCode)
  );
  return {
    ...shared,
    title: row?.title ?? "",
    summary: row?.summary ?? "",
    html: row?.body ?? "",
    seoTitle: row?.seo_title ?? "",
    seoDescription: row?.seo_description ?? "",
    languageCode: row?.language_code ?? languageCode,
  };
}

/**
 * Set APPROVED, PUBLISHING, or PUBLISHED from how many ticked languages are live.
 * Counts every ticked language with an active provider, not only the ones due now.
 * Returns true when the status changed.
 */
export async function syncArticlePublishStatus(contentId: string): Promise<boolean> {
  const db = await getDb();
  const { data: article, error } = await db
    .from("content")
    .select("id, application_id, status, published_at")
    .eq("id", contentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!article || !isPublishable(article.status as string)) return false;

  const [{ data: targetRows, error: targetsError }, { data: publicationRows, error: publicationsError }] =
    await Promise.all([
      db.from("content_publish_targets").select("vendor_id, language_code").eq("content_id", contentId),
      db
        .from("content_publications")
        .select("content_id, vendor_id, language_code, status")
        .eq("content_id", contentId),
    ]);
  if (targetsError) throwPublishError(targetsError);
  if (publicationsError) throwPublishError(publicationsError);
  const rows = (targetRows ?? []) as { vendor_id: string; language_code: string }[];
  const vendorIds = [...new Set(rows.map((row) => String(row.vendor_id)))];
  const vendorsById = new Map<string, VendorRecord>();
  if (vendorIds.length > 0) {
    const { data: vendors, error: vendorsError } = await db
      .from("publish_vendors")
      .select("id, application_id, name, type_code, config, status")
      .in("id", vendorIds);
    if (vendorsError) throwPublishError(vendorsError);
    for (const vendor of (vendors ?? []) as VendorRecord[]) vendorsById.set(vendor.id, vendor);
  }
  const ticked = assignmentsFor(rows, String(article.application_id), vendorsById);
  const live = ticked.filter(
    (target) =>
      findPublication(publicationRows, contentId, target.vendor.id, target.languageCode)?.status === "PUBLISHED"
  ).length;
  const next = nextPublishStatus(article.status as string, ticked.length, live);
  if (!next) return false;

  const { error: updateError } = await db
    .from("content")
    .update({
      status: next,
      published_at: next === "PUBLISHED" ? (article.published_at ?? new Date().toISOString()) : null,
    })
    .eq("id", contentId)
    .eq("status", article.status as string);
  if (updateError) throwPublishError(updateError);
  return true;
}

async function claimPublication(
  contentId: string,
  vendorId: string,
  languageCode: string,
  existingId?: string
) {
  const db = await getDb();
  const attempted_at = new Date().toISOString();
  if (!existingId) {
    const { data, error } = await db
      .from("content_publications")
      .insert({
        content_id: contentId,
        vendor_id: vendorId,
        language_code: languageCode,
        status: "PENDING",
        error_message: null,
        attempted_at,
      })
      .select("id")
      .single();
    if (!error && data?.id) return String(data.id);
    if (error && error.code !== "23505") throwPublishError(error);
    const { data: raced, error: racedError } = await db
      .from("content_publications")
      .select("id")
      .eq("content_id", contentId)
      .eq("vendor_id", vendorId)
      .eq("language_code", languageCode)
      .single();
    if (racedError) throwPublishError(racedError);
    existingId = String(raced.id);
  }

  const { error } = await db
    .from("content_publications")
    .update({ status: "PENDING", error_message: null, attempted_at })
    .eq("id", existingId)
    .neq("status", "PUBLISHED");
  if (error) throwPublishError(error);
  return existingId;
}

async function savePublication(
  id: string,
  patch: {
    status: "PUBLISHED" | "FAILED";
    external_url: string | null;
    error_message: string | null;
    published_at: string | null;
  }
) {
  const db = await getDb();
  const { error } = await db.from("content_publications").update(patch).eq("id", id);
  if (error) throwPublishError(error);
}

function note(result: PublishRunResult, message: string) {
  if (result.notes.length < 8) result.notes.push(message);
}
