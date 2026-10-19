"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import {
  parseArticleTranslationFile,
  parseStringTranslationFile,
  summarizePreview,
  type ArticleImportPreviewItem,
  type StringImportPreviewItem,
} from "@/lib/import/parse";
import {
  createNamespace,
  listNamespaces,
  upsertStringTranslation,
  autoTranslateKeyLanguages,
} from "@/lib/actions/product";
import {
  createArticle,
  upsertContentTranslation,
  autoTranslateArticleLanguages,
} from "@/lib/actions/press";
import { ensureContentType } from "@/lib/actions/content-types";
import type { ContentLifecycleStatus, SourceContentFields } from "@/lib/types";
import { emptySourceContent } from "@/lib/types";
import { requireAppCapability, requireChosenMarket } from "@/lib/auth/access";
import { normalizeTargetLanguages } from "@/lib/target-languages";
import { errorMessage } from "@/lib/errors";

export async function previewStringImport(input: {
  applicationId: string;
  filename: string;
  base64: string;
}): Promise<{
  items: StringImportPreviewItem[];
  summary: ReturnType<typeof summarizePreview>;
}> {
  await requireAppCapability(input.applicationId, "content.import");
  const buffer = Buffer.from(input.base64, "base64");
  const rows = parseStringTranslationFile(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ),
    input.filename
  );

  const db = await getDb();
  const namespaces = await listNamespaces(input.applicationId, {
    includeInactive: true,
  });
  const nsByName = new Map(
    namespaces.map((n) => [n.name.toLowerCase(), n])
  );

  const { data: existingKeys, error } = await db
    .from("translation_keys")
    .select("id, key, source_text, translations(language_code, current_text)")
    .eq("application_id", input.applicationId);
  if (error) throw new Error(error.message);

  const keyMap = new Map(
    (existingKeys ?? []).map((k) => [
      k.key,
      k as {
        id: string;
        key: string;
        source_text: string;
        translations: { language_code: string; current_text: string }[];
      },
    ])
  );

  const items: StringImportPreviewItem[] = rows.map((row) => {
    if (!row.namespace || !row.key) {
      return { ...row, action: "ERROR", error: "Missing namespace or key" };
    }
    if (!nsByName.has(row.namespace.toLowerCase())) {
      // Namespace will be created on import
    }
    const existing = keyMap.get(row.key);
    if (!existing) {
      return { ...row, action: "NEW" };
    }

    const sourceLang =
      Object.keys(row.translations).find((c) => c === "en") ??
      Object.keys(row.translations)[0];
    const sourceText = sourceLang ? row.translations[sourceLang] : "";
    let changed = sourceText && sourceText !== existing.source_text;
    if (!changed) {
      for (const [lang, text] of Object.entries(row.translations)) {
        const current = existing.translations?.find(
          (t) => t.language_code === lang
        )?.current_text;
        if (current !== text) {
          changed = true;
          break;
        }
      }
    }
    return {
      ...row,
      action: changed ? "UPDATED" : "UNCHANGED",
      existingKeyId: existing.id,
    };
  });

  return { items, summary: summarizePreview(items) };
}

export async function confirmStringImport(input: {
  applicationId: string;
  filename: string;
  base64: string;
  defaultSourceLanguage?: string;
  translateLanguages?: string[];
}): Promise<{
  imported: number;
  updated: number;
  unchanged: number;
  errors: number;
  translated: number;
}> {
  await requireAppCapability(input.applicationId, "content.import");
  const preview = await previewStringImport(input);
  const db = await getDb();
  const sourceLanguage = input.defaultSourceLanguage ?? "en";
  const translateLanguages = (input.translateLanguages ?? []).filter(
    (code) => code && code !== sourceLanguage
  );

  let imported = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  let translated = 0;

  for (const item of preview.items) {
    if (item.action === "ERROR") {
      errors += 1;
      continue;
    }
    if (item.action === "UNCHANGED") {
      unchanged += 1;
      continue;
    }

    try {
      let namespace = (
        await listNamespaces(input.applicationId, { includeInactive: true })
      ).find((n) => n.name.toLowerCase() === item.namespace.toLowerCase());

      if (!namespace) {
        namespace = await createNamespace({
          application_id: input.applicationId,
          name: item.namespace,
          description: "",
        });
      }

      const sourceText =
        item.translations[sourceLanguage] ??
        item.translations.en ??
        Object.values(item.translations)[0] ??
        "";

      let keyId = item.existingKeyId;
      if (!keyId) {
        const { data, error } = await db
          .from("translation_keys")
          .insert({
            application_id: input.applicationId,
            namespace_id: namespace.id,
            key: item.key,
            source_language: sourceLanguage,
            source_text: sourceText,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        keyId = data.id;
        imported += 1;
      } else {
        const { error } = await db
          .from("translation_keys")
          .update({
            namespace_id: namespace.id,
            source_language: sourceLanguage,
            source_text: sourceText || undefined,
          })
          .eq("id", keyId);
        if (error) throw new Error(error.message);
        updated += 1;
      }

      for (const [lang, text] of Object.entries(item.translations)) {
        await upsertStringTranslation({
          translation_key_id: keyId as string,
          language_code: lang,
          text,
          source_type: "IMPORT",
          status: "MANUALLY_MODIFIED",
        });
      }

      const missingTranslate = translateLanguages.filter(
        (code) => !item.translations[code]
      );
      if (missingTranslate.length > 0) {
        const results = await autoTranslateKeyLanguages({
          translationKeyId: keyId as string,
          targetLanguages: missingTranslate,
          applicationId: input.applicationId,
        });
        translated += results.length;
      }
    } catch {
      errors += 1;
    }
  }

  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath("/import");
  return { imported, updated, unchanged, errors, translated };
}

/** A row that was not imported, with the reason in plain words. */
export type SkippedImportRow = { row: number; title: string; reason: string };

/** An article the import created, so the summary can link to it. */
export type CreatedImportArticle = { id: string; title: string; market: string; status: string };

export async function previewArticleImport(input: {
  applicationId: string;
  filename: string;
  base64: string;
}): Promise<{
  items: ArticleImportPreviewItem[];
  summary: ReturnType<typeof summarizePreview>;
}> {
  const grant = await requireAppCapability(input.applicationId, "content.import");
  const buffer = Buffer.from(input.base64, "base64");
  const rows = parseArticleTranslationFile(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ),
    input.filename
  );

  // Someone who covers one country needs no market column: there is nothing to guess.
  const onlyMarket = grant.access.markets?.length === 1 ? grant.access.markets[0] : null;
  const items: ArticleImportPreviewItem[] = rows.map((row) => {
    if (!row.title) {
      return { ...row, action: "ERROR", error: "The title is blank." };
    }
    const given = row.market || onlyMarket;
    if (!given) {
      return { ...row, action: "ERROR", error: "The market is blank. Add a country code such as MY." };
    }
    try {
      const market = requireChosenMarket(grant.access, given);
      return { ...row, market, action: "NEW" };
    } catch (error) {
      return { ...row, action: "ERROR", error: errorMessage(error, "The market is not valid.") };
    }
  });

  return { items, summary: summarizePreview(items) };
}

export async function confirmArticleImport(input: {
  applicationId: string;
  filename: string;
  base64: string;
  translateLanguages?: string[];
}): Promise<{
  imported: number;
  updated: number;
  unchanged: number;
  errors: number;
  /** Rows that were skipped or failed, and why. */
  skipped: SkippedImportRow[];
  /** Articles created, newest last. */
  created: CreatedImportArticle[];
  translated: number;
  typesCreated: number;
}> {
  const grant = await requireAppCapability(input.applicationId, "content.import");
  const importedTranslationStatus = grant.access.can_approve
    ? "APPROVED"
    : "MANUALLY_MODIFIED";
  const preview = await previewArticleImport(input);
  const translateLanguages = input.translateLanguages ?? [];
  let imported = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  const skipped: SkippedImportRow[] = [];
  const createdArticles: CreatedImportArticle[] = [];
  let translated = 0;
  let typesCreated = 0;

  for (const item of preview.items) {
    if (item.action === "ERROR") {
      errors += 1;
      skipped.push({ row: item.rowNumber, title: item.title, reason: item.error ?? "Could not import this row." });
      continue;
    }
    if (item.action === "UNCHANGED") {
      unchanged += 1;
      continue;
    }

    try {
      const fields: SourceContentFields = {
        ...emptySourceContent(),
        ...item.fields,
      };
      const targetLanguages = normalizeTargetLanguages(
        [...Object.keys(item.translations), ...translateLanguages],
        item.source_language
      );
      const type = await ensureContentType(
        input.applicationId,
        item.content_type
      );
      if (type.created) typesCreated += 1;
      const created = await createArticle({
        application_id: input.applicationId,
        title: item.title,
        slug: null,
        source_language: item.source_language,
        source_content: fields,
        content_type: type.code,
        market: item.market,
        // TRANSLATING is retired; older files that still use it import as drafts.
        status:
          item.status === "TRANSLATING"
            ? "DRAFT"
            : (item.status as ContentLifecycleStatus) || "DRAFT",
        target_languages: targetLanguages,
        // The file's status column decides, also for approvers.
        keepStatus: true,
      });
      const contentId = created.id;
      imported += 1;
      createdArticles.push({
        id: contentId,
        title: created.title,
        market: created.market ?? "",
        status: created.status,
      });

      for (const [lang, partial] of Object.entries(item.translations)) {
        await upsertContentTranslation({
          content_id: contentId,
          language_code: lang,
          fields: {
            ...emptySourceContent(),
            ...partial,
            title: partial.title ?? item.title,
          },
          source_type: "IMPORT",
          status: importedTranslationStatus,
        });
      }

      const missingTranslate = translateLanguages.filter(
        (code) =>
          code &&
          code !== item.source_language &&
          !item.translations[code]
      );
      if (missingTranslate.length > 0) {
        const results = await autoTranslateArticleLanguages({
          contentId,
          targetLanguages: missingTranslate,
          applicationId: input.applicationId,
          approveTranslations: grant.access.can_approve,
        });
        translated += results.length;
      }
    } catch (error) {
      errors += 1;
      skipped.push({
        row: item.rowNumber,
        title: item.title,
        reason: errorMessage(error, "Could not import this row."),
      });
    }
  }

  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath("/import");
  return {
    imported,
    updated,
    unchanged,
    errors,
    skipped,
    created: createdArticles,
    translated,
    typesCreated,
  };
}
