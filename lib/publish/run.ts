import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { throwPublishError } from "@/lib/publish/errors";
import { deliverToVendor, publicationInFlight } from "@/lib/publish/deliver";
import type { PublishArticle } from "@/lib/publish/integrations/integration";
import type { SourceContentFields } from "@/lib/types";
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
    "id, application_id, title, slug, content_type, source_language, source_content, market, status, scheduled_publish_at, target_languages, content_publish_targets!inner(vendor_id, language_code)";

  async function loadQueue(status: "APPROVED" | "PUBLISHED", recentFirst: boolean) {
    let query = db
      .from("content")
      .select(columns)
      .eq("status", status)
      .not("scheduled_publish_at", "is", null)
      .lte("scheduled_publish_at", nowIso)
      .order(recentFirst ? "updated_at" : "scheduled_publish_at", { ascending: !recentFirst })
      .limit(BATCH);
    if (applicationId) query = query.eq("application_id", applicationId);
    const { data, error } = await query;
    if (error) throwPublishError(error);
    const rows = (data ?? []) as Array<
      DueArticle & { content_publish_targets: { vendor_id: string; language_code: string }[] }
    >;
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }

  const approved = await loadQueue("APPROVED", false);
  const published = await loadQueue("PUBLISHED", true);
  const dueArticles = [...approved];
  const seen = new Set(approved.map((article) => article.id));
  for (const article of published) {
    if (!seen.has(article.id)) dueArticles.push(article);
  }
  const targets = dueArticles.flatMap((article) => {
    const nested = article.content_publish_targets;
    const rows = Array.isArray(nested) ? nested : nested ? [nested] : [];
    return rows.map((row) => ({
      content_id: article.id,
      vendor_id: row.vendor_id,
      language_code: row.language_code,
    }));
  });

  if (dueArticles.length === 0) {
    result.notes.push(
      "No approved articles with a language assigned to a provider are due. Approve the article, choose a provider for each language, and set the estimated publish time to now or earlier."
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
    const activeTargets = assignmentsFor(articleTargets, article.application_id, vendorsById);
    const unfinished = activeTargets.filter((target) => {
      const existing = findPublication(publications, article.id, target.vendor.id, target.languageCode);
      return existing?.status !== "PUBLISHED";
    });
    if (activeTargets.length > 0 && unfinished.length === 0) {
      if (article.status === "APPROVED") {
        await markArticlePublished(article.id);
        touchedApps.add(article.application_id);
      }
      continue;
    }
    result.due += 1;
    if (article.status !== "APPROVED" && article.status !== "PUBLISHED") {
      result.skipped += 1;
      note(result, `${article.title}: the article is not approved.`);
      continue;
    }
    if (activeTargets.length === 0) {
      result.skipped += 1;
      note(result, `${article.title}: no active provider is selected.`);
      continue;
    }

    let deliveredAll = true;
    for (const target of activeTargets) {
      const vendor = target.vendor;
      const existing = findPublication(publications, article.id, vendor.id, target.languageCode);
      if (existing?.status === "PUBLISHED") continue;
      const block = languageBlock(article, articleTranslations, target.languageCode);
      if (block) {
        deliveredAll = false;
        result.skipped += 1;
        note(result, `${article.title}: ${block}`);
        continue;
      }
      if (existing?.status === "PENDING" && publicationInFlight(existing.attempted_at ?? null)) {
        deliveredAll = false;
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
        deliveredAll = false;
        note(result, `${article.title}: ${target.languageCode} to ${vendor.name} failed. ${delivery.error}`);
      }
    }

    if (deliveredAll && article.status === "APPROVED") {
      await markArticlePublished(article.id);
      touchedApps.add(article.application_id);
    }
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
      "No approved articles with a language assigned to a provider are due. Approve the article, choose a provider for each language, and set the estimated publish time to now or earlier."
    );
  }
  return result;
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

async function markArticlePublished(contentId: string) {
  const db = await getDb();
  const { error } = await db
    .from("content")
    .update({
      status: "PUBLISHED",
      published_at: new Date().toISOString(),
    })
    .eq("id", contentId)
    .eq("status", "APPROVED");
  if (error) throw new Error(error.message);
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
