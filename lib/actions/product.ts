"use server";

import { revalidatePath } from "next/cache";
import { escapeIlike, getDb } from "@/lib/db/client";
import type {
  EntityStatus,
  Namespace,
  Paginated,
  SourceType,
  Translation,
  TranslationKey,
  TranslationStatus,
  TranslationVersion,
} from "@/lib/types";
import { approvalStamp, versionAuthorFields } from "@/lib/auth/actor";
import { getTranslationService } from "@/lib/translation/service";

export async function listNamespaces(
  applicationId: string,
  opts?: { includeInactive?: boolean }
): Promise<Namespace[]> {
  const db = await getDb();
  let query = db
    .from("namespaces")
    .select("*")
    .eq("application_id", applicationId)
    .order("name", { ascending: true });
  if (!opts?.includeInactive) {
    query = query.eq("status", "ACTIVE");
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Namespace[];
}

export async function createNamespace(input: {
  application_id: string;
  name: string;
  description: string;
}): Promise<Namespace> {
  const db = await getDb();
  const { data, error } = await db
    .from("namespaces")
    .insert({
      application_id: input.application_id,
      name: input.name.trim(),
      description: input.description.trim(),
      status: "ACTIVE",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${input.application_id}`);
  return data as Namespace;
}

export async function updateNamespace(
  id: string,
  applicationId: string,
  input: { name: string; description: string; status: EntityStatus }
): Promise<Namespace> {
  const db = await getDb();
  const { data, error } = await db
    .from("namespaces")
    .update({
      name: input.name.trim(),
      description: input.description.trim(),
      status: input.status,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${applicationId}`);
  return data as Namespace;
}

export type TranslationKeyListItem = TranslationKey & {
  namespace: Pick<Namespace, "id" | "name"> | null;
  translations: (Pick<
    Translation,
    "id" | "language_code" | "current_text" | "status"
  > & {
    approved_by_name?: string | null;
  })[];
};

export async function listTranslationKeys(input: {
  applicationId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  namespaceId?: string;
  languageCode?: string;
  status?: TranslationStatus;
}): Promise<Paginated<TranslationKeyListItem>> {
  const db = await getDb();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let keyQuery = db
    .from("translation_keys")
    .select(
      `
      *,
      namespace:namespaces!inner(id, name),
      translations(id, language_code, current_text, status)
    `,
      { count: "exact" }
    )
    .eq("application_id", input.applicationId)
    .order("key", { ascending: true })
    .range(from, to);

  if (input.namespaceId) {
    keyQuery = keyQuery.eq("namespace_id", input.namespaceId);
  }
  if (input.search?.trim()) {
    const term = escapeIlike(input.search.trim());
    keyQuery = keyQuery.or(
      `key.ilike.%${term}%,source_text.ilike.%${term}%`
    );
  }

  const { data, error, count } = await keyQuery;
  if (error) throw new Error(error.message);

  let items = (data ?? []) as TranslationKeyListItem[];

  if (input.languageCode || input.status) {
    items = items.filter((item) => {
      const translations = item.translations ?? [];
      if (input.languageCode && input.status) {
        const match = translations.find(
          (t) => t.language_code === input.languageCode
        );
        if (!match) return input.status === "MISSING";
        return match.status === input.status;
      }
      if (input.languageCode) {
        return translations.some(
          (t) =>
            t.language_code === input.languageCode &&
            t.current_text.trim() !== ""
        );
      }
      if (input.status === "MISSING") {
        // Keys missing any active language translation are handled in UI;
        // here filter keys that have at least one MISSING row OR no translations.
        return (
          translations.length === 0 ||
          translations.some((t) => t.status === "MISSING")
        );
      }
      return translations.some((t) => t.status === input.status);
    });
  }

  return {
    items,
    total: count ?? items.length,
    page,
    pageSize,
  };
}

export async function getTranslationKey(
  id: string
): Promise<TranslationKeyListItem | null> {
  const db = await getDb();
  const { data, error } = await db
    .from("translation_keys")
    .select(
      `
      *,
      namespace:namespaces(id, name),
      translations(id, language_code, current_text, status, approved_by_name, created_at, updated_at)
    `
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as TranslationKeyListItem | null;
}

export async function createTranslationKey(input: {
  application_id: string;
  namespace_id: string;
  key: string;
  source_language: string;
  source_text: string;
}): Promise<TranslationKey> {
  const db = await getDb();
  const { data, error } = await db
    .from("translation_keys")
    .insert({
      application_id: input.application_id,
      namespace_id: input.namespace_id,
      key: input.key.trim(),
      source_language: input.source_language,
      source_text: input.source_text,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // Ensure source language translation row exists
  await upsertStringTranslation({
    translation_key_id: data.id,
    language_code: input.source_language,
    text: input.source_text,
    source_type: "MANUAL",
    status: "MANUALLY_MODIFIED",
  });

  revalidatePath(`/applications/${input.application_id}`);
  return data as TranslationKey;
}

export async function updateTranslationKey(
  id: string,
  applicationId: string,
  input: {
    namespace_id: string;
    key: string;
    source_language: string;
    source_text: string;
  }
): Promise<TranslationKey> {
  const db = await getDb();
  const { data, error } = await db
    .from("translation_keys")
    .update({
      namespace_id: input.namespace_id,
      key: input.key.trim(),
      source_language: input.source_language,
      source_text: input.source_text,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/translations/${id}`);
  return data as TranslationKey;
}

async function nextTranslationVersionNumber(
  translationId: string
): Promise<number> {
  const db = await getDb();
  const { data, error } = await db
    .from("translation_versions")
    .select("version_number")
    .eq("translation_id", translationId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.version_number ?? 0) + 1;
}

export async function upsertStringTranslation(input: {
  translation_key_id: string;
  language_code: string;
  text: string;
  source_type: SourceType;
  status?: TranslationStatus;
}): Promise<Translation> {
  const db = await getDb();
  const status: TranslationStatus =
    input.status ??
    (input.text.trim()
      ? input.source_type === "MANUAL"
        ? "MANUALLY_MODIFIED"
        : input.source_type === "SYSTEM"
          ? "SYSTEM_GENERATED"
          : "MANUALLY_MODIFIED"
      : "MISSING");

  const { data: existing, error: findError } = await db
    .from("translations")
    .select("*")
    .eq("translation_key_id", input.translation_key_id)
    .eq("language_code", input.language_code)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  let translation: Translation;
  if (existing) {
    if (
      existing.current_text === input.text &&
      existing.status === status
    ) {
      return existing as Translation;
    }
    const { data, error } = await db
      .from("translations")
      .update({
        current_text: input.text,
        status,
        approved_by_username: null,
        approved_by_name: null,
        approved_at: null,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    translation = data as Translation;
  } else {
    const { data, error } = await db
      .from("translations")
      .insert({
        translation_key_id: input.translation_key_id,
        language_code: input.language_code,
        current_text: input.text,
        status,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    translation = data as Translation;
  }

  const versionNumber = await nextTranslationVersionNumber(translation.id);
  const actorFields = await versionAuthorFields(input.source_type);
  const { error: versionError } = await db.from("translation_versions").insert({
    translation_id: translation.id,
    version_number: versionNumber,
    translated_content: input.text,
    source_type: input.source_type,
    ...actorFields,
  });
  if (versionError) throw new Error(versionError.message);

  return translation;
}

export async function listTranslationVersions(
  translationId: string
): Promise<TranslationVersion[]> {
  const db = await getDb();
  const { data, error } = await db
    .from("translation_versions")
    .select("*")
    .eq("translation_id", translationId)
    .order("version_number", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TranslationVersion[];
}

export async function deleteTranslationVersion(input: {
  versionId: string;
  applicationId: string;
  translationKeyId: string;
}): Promise<void> {
  const db = await getDb();
  const { error } = await db
    .from("translation_versions")
    .delete()
    .eq("id", input.versionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(
    `/applications/${input.applicationId}/translations/${input.translationKeyId}`
  );
}

export async function setStringTranslationStatus(input: {
  translationId: string;
  status: TranslationStatus;
  applicationId: string;
  translationKeyId: string;
}): Promise<void> {
  const db = await getDb();
  const approval = await approvalStamp(input.status);
  const { error } = await db
    .from("translations")
    .update({ status: input.status, ...approval })
    .eq("id", input.translationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(
    `/applications/${input.applicationId}/translations/${input.translationKeyId}`
  );
}

export async function autoTranslateKey(input: {
  translationKeyId: string;
  targetLanguage: string;
  applicationId: string;
}): Promise<Translation> {
  const key = await getTranslationKey(input.translationKeyId);
  if (!key) throw new Error("Translation key not found");

  const service = getTranslationService();
  const translated = await service.translateText({
    text: key.source_text,
    sourceLanguage: key.source_language,
    targetLanguage: input.targetLanguage,
  });

  const result = await upsertStringTranslation({
    translation_key_id: key.id,
    language_code: input.targetLanguage,
    text: translated,
    source_type: "SYSTEM",
    status: "SYSTEM_GENERATED",
  });

  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(
    `/applications/${input.applicationId}/translations/${input.translationKeyId}`
  );
  return result;
}

export async function autoTranslateKeyLanguages(input: {
  translationKeyId: string;
  targetLanguages: string[];
  applicationId: string;
}): Promise<Translation[]> {
  const results: Translation[] = [];
  for (const targetLanguage of input.targetLanguages) {
    results.push(
      await autoTranslateKey({
        translationKeyId: input.translationKeyId,
        targetLanguage,
        applicationId: input.applicationId,
      })
    );
  }
  return results;
}

export async function saveManualStringTranslation(input: {
  translationKeyId: string;
  languageCode: string;
  text: string;
  applicationId: string;
}): Promise<Translation> {
  const result = await upsertStringTranslation({
    translation_key_id: input.translationKeyId,
    language_code: input.languageCode,
    text: input.text,
    source_type: "MANUAL",
    status: "MANUALLY_MODIFIED",
  });
  revalidatePath(`/applications/${input.applicationId}`);
  revalidatePath(
    `/applications/${input.applicationId}/translations/${input.translationKeyId}`
  );
  return result;
}

export async function getProductStats(applicationId: string) {
  const db = await getDb();
  const { count: keyCount, error: keyError } = await db
    .from("translation_keys")
    .select("*", { count: "exact", head: true })
    .eq("application_id", applicationId);
  if (keyError) throw new Error(keyError.message);

  // Count translation rows by joining through keys for this application.
  // Avoid loading all key IDs into memory (Product may have millions of keys).
  const { data: keyRows, error: keysError } = await db
    .from("translation_keys")
    .select("id")
    .eq("application_id", applicationId)
    .limit(1);
  if (keysError) throw new Error(keysError.message);

  let translated = 0;
  let missing = 0;

  if ((keyCount ?? 0) > 0 && keyRows) {
    const { count: translatedCount, error: tErr } = await db
      .from("translations")
      .select("id, translation_keys!inner(application_id)", {
        count: "exact",
        head: true,
      })
      .eq("translation_keys.application_id", applicationId)
      .neq("status", "MISSING");
    if (tErr) throw new Error(tErr.message);

    const { count: missingCount, error: mErr } = await db
      .from("translations")
      .select("id, translation_keys!inner(application_id)", {
        count: "exact",
        head: true,
      })
      .eq("translation_keys.application_id", applicationId)
      .eq("status", "MISSING");
    if (mErr) throw new Error(mErr.message);

    translated = translatedCount ?? 0;
    missing = missingCount ?? 0;
  }

  return {
    translationKeys: keyCount ?? 0,
    translated,
    missing,
  };
}
