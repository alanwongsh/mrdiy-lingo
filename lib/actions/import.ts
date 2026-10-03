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
import type { ContentLifecycleStatus, ContentType, SourceContentFields } from "@/lib/types";
import { emptySourceContent } from "@/lib/types";
import { normalizeTargetLanguages } from "@/lib/target-languages";

export async function previewStringImport(input: {
  applicationId: string;
  filename: string;
  base64: string;
}): Promise<{
  items: StringImportPreviewItem[];
  summary: ReturnType<typeof summarizePreview>;
}> {
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

export async function previewArticleImport(input: {
  applicationId: string;
  filename: string;
  base64: string;
}): Promise<{
  items: ArticleImportPreviewItem[];
  summary: ReturnType<typeof summarizePreview>;
}> {
  const buffer = Buffer.from(input.base64, "base64");
  const rows = parseArticleTranslationFile(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ),
    input.filename
  );

  const items: ArticleImportPreviewItem[] = rows.map((row) => {
    if (!row.title) {
      return { ...row, action: "ERROR", error: "Missing title" };
    }
    return { ...row, action: "NEW" };
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
  translated: number;
}> {
  const preview = await previewArticleImport(input);
  const translateLanguages = input.translateLanguages ?? [];
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
      const fields: SourceContentFields = {
        ...emptySourceContent(),
        ...item.fields,
      };
      const targetLanguages = normalizeTargetLanguages(
        [...Object.keys(item.translations), ...translateLanguages],
        item.source_language
      );
      const created = await createArticle({
        application_id: input.applicationId,
        title: item.title,
        slug: null,
        source_language: item.source_language,
        source_content: fields,
        content_type: (item.content_type as ContentType) || "ARTICLE",
        status: (item.status as ContentLifecycleStatus) || "DRAFT",
        target_languages: targetLanguages,
      });
      const contentId = created.id;
      imported += 1;

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
