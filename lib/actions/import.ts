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

  const db = await getDb();
  const { data: existing, error } = await db
    .from("content")
    .select(
      "id, title, source_language, content_type, status, source_content, translations:content_translations(language_code, title, summary, body, seo_title, seo_description)"
    )
    .eq("application_id", input.applicationId);
  if (error) throw new Error(error.message);

  type ExistingArticle = {
    id: string;
    title: string;
    source_language: string;
    content_type: string;
    status: string;
    source_content: SourceContentFields | null;
    translations: {
      language_code: string;
      title: string;
      summary: string;
      body: string;
      seo_title: string;
      seo_description: string;
    }[];
  };

  const byTitle = new Map(
    ((existing ?? []) as ExistingArticle[]).map((c) => [
      c.title.toLowerCase(),
      c,
    ])
  );

  function fieldChanged(
    a: Partial<SourceContentFields> | null | undefined,
    b: Partial<SourceContentFields> | null | undefined
  ) {
    const left = { ...emptySourceContent(), ...a };
    const right = { ...emptySourceContent(), ...b };
    return (
      left.title !== right.title ||
      left.summary !== right.summary ||
      left.body !== right.body ||
      left.seo_title !== right.seo_title ||
      left.seo_description !== right.seo_description
    );
  }

  const items: ArticleImportPreviewItem[] = rows.map((row) => {
    if (!row.title) {
      return { ...row, action: "ERROR", error: "Missing title" };
    }
    const found = byTitle.get(row.title.toLowerCase());
    if (!found) return { ...row, action: "NEW" };

    const sourceFields: SourceContentFields = {
      ...emptySourceContent(),
      ...row.fields,
      title: row.fields.title || row.title,
    };
    const existingSource = {
      ...emptySourceContent(),
      ...(found.source_content ?? {}),
      title: found.source_content?.title || found.title,
    };

    let changed =
      found.source_language !== row.source_language ||
      found.content_type !== row.content_type ||
      found.status !== row.status ||
      fieldChanged(existingSource, sourceFields);

    if (!changed) {
      for (const [lang, partial] of Object.entries(row.translations)) {
        const current = found.translations?.find(
          (t) => t.language_code === lang
        );
        const incoming = {
          ...emptySourceContent(),
          ...partial,
          title: partial.title ?? row.title,
        };
        if (!current || fieldChanged(current, incoming)) {
          changed = true;
          break;
        }
      }
    }

    // Also treat as changed when DB has fewer import languages than the file,
    // or when source-language translation differs from import source fields.
    if (!changed) {
      const sourceTranslation = found.translations?.find(
        (t) => t.language_code === row.source_language
      );
      if (!sourceTranslation || fieldChanged(sourceTranslation, sourceFields)) {
        changed = true;
      }
    }

    return {
      ...row,
      action: changed ? "UPDATED" : "UNCHANGED",
      existingContentId: found.id,
    };
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
      let contentId = item.existingContentId;
      if (!contentId) {
        const created = await createArticle({
          application_id: input.applicationId,
          title: item.title,
          source_language: item.source_language,
          source_content: fields,
          content_type: (item.content_type as ContentType) || "ARTICLE",
          status: (item.status as ContentLifecycleStatus) || "DRAFT",
          target_languages: targetLanguages,
        });
        contentId = created.id;
        imported += 1;
      } else {
        const db = await getDb();
        const { data: existingRow } = await db
          .from("content")
          .select("target_languages")
          .eq("id", contentId)
          .maybeSingle();
        const mergedTargets = normalizeTargetLanguages(
          [
            ...((existingRow?.target_languages as string[] | null) ?? []),
            ...targetLanguages,
          ],
          item.source_language
        );
        const { error } = await db
          .from("content")
          .update({
            title: item.title,
            source_language: item.source_language,
            source_content: fields,
            content_type: item.content_type,
            status: item.status,
            target_languages: mergedTargets,
          })
          .eq("id", contentId);
        if (error) throw new Error(error.message);
        await upsertContentTranslation({
          content_id: contentId,
          language_code: item.source_language,
          fields,
          source_type: "IMPORT",
        });
        updated += 1;
      }

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
