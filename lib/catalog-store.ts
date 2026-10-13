import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { approvalStamp, getActor } from "@/lib/auth/actor";
import { currentActionId } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import {
  hasValue,
  isMachineTranslatable,
  itemFields,
  isStale,
  languageProgress,
} from "@/lib/catalog";
import type {
  CatalogItem,
  CatalogEventKind,
  CatalogField,
  ItemStatus,
  CatalogValue,
  CatalogValueSource,
  TranslationStatus,
} from "@/lib/types";
import { manualSaveStatus } from "@/lib/types";

export const CATALOG_BUCKET = "catalog-files";

const SCHEMA_MESSAGE =
  "Run migration 024_catalog.sql (npm run db:migrate) before using catalog applications.";

export function throwItemError(error: { message: string; code?: string }): never {
  if (
    error.code === "42P01" ||
    (/catalog_|translation_memory/i.test(error.message) &&
      /does not exist|schema cache|Could not find/i.test(error.message))
  ) {
    throw new Error(SCHEMA_MESSAGE);
  }
  throw new Error(error.message);
}

/** Same text, same hash: whitespace differences do not count as a change. */
export function textHash(text: string): string {
  return createHash("sha256").update(text.trim().replace(/\s+/g, " ")).digest("hex");
}

export function revalidateItem(applicationId: string, itemId?: string) {
  revalidatePath(`/applications/${applicationId}/items`);
  if (itemId) revalidatePath(`/applications/${applicationId}/items/${itemId}`);
}

export async function loadItem(id: string): Promise<CatalogItem | null> {
  const db = await getDb();
  const { data, error } = await db.from("catalog_items").select("*").eq("id", id).maybeSingle();
  if (error) throwItemError(error);
  return (data as CatalogItem | null) ?? null;
}

export async function loadItemFields(
  applicationId: string,
  opts?: { includeInactive?: boolean }
): Promise<CatalogField[]> {
  const db = await getDb();
  let query = db
    .from("catalog_fields")
    .select("*")
    .eq("application_id", applicationId)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (!opts?.includeInactive) query = query.eq("status", "ACTIVE");
  const { data, error } = await query;
  if (error) throwItemError(error);
  return (data ?? []) as CatalogField[];
}

/** PostgREST returns at most 1000 rows per request, so read in pages. */
export async function loadItemValues(itemIds: string[]): Promise<CatalogValue[]> {
  if (itemIds.length === 0) return [];
  const db = await getDb();
  const rows: CatalogValue[] = [];
  for (let i = 0; i < itemIds.length; i += 100) {
    const ids = itemIds.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("catalog_values")
        .select("*")
        .in("item_id", ids)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throwItemError(error);
      rows.push(...((data ?? []) as CatalogValue[]));
      if (!data || data.length < 1000) break;
    }
  }
  return rows;
}

export async function recordItemEvent(input: {
  item: Pick<CatalogItem, "id" | "application_id" | "item_code">;
  event: CatalogEventKind;
  userId?: string | null;
  languageCode?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  comment?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const actor = await getActor();
    const db = await getDb();
    const { error } = await db.from("catalog_events").insert({
      item_id: input.item.id,
      application_id: input.item.application_id,
      item_code: input.item.item_code,
      event: input.event,
      language_code: input.languageCode ?? null,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus ?? null,
      comment: input.comment ?? null,
      // Same id for every event in one request, so the activity list shows them as one entry.
      detail: { ...input.detail, action_id: currentActionId() },
      actor_name: actor?.name ?? "System",
      actor_username: actor?.username ?? null,
      actor_user_id: input.userId ?? null,
    });
    if (error) console.error("[catalog_events]", error.message);
  } catch (error) {
    // The change itself is already saved; a missing trail entry must not undo it.
    console.error("[catalog_events]", error);
  }
}

export async function updateItemStatus(
  item: CatalogItem,
  status: ItemStatus,
  extra: Record<string, unknown> = {}
): Promise<CatalogItem> {
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_items")
    .update({ status, ...extra })
    .eq("id", item.id)
    .select("*")
    .single();
  if (error) throwItemError(error);
  return data as CatalogItem;
}

/** An approved item goes back to review when something in it is no longer approved. */
export async function reopenIfApproved(
  item: CatalogItem,
  reason: string,
  userId?: string | null
): Promise<CatalogItem> {
  if (item.status !== "APPROVED") return item;
  const next = await updateItemStatus(item, "REVIEW", {
    approved_by_name: null,
    approved_by_username: null,
    approved_by_user_id: null,
    approved_at: null,
  });
  await recordItemEvent({
    item,
    event: "REOPENED",
    userId,
    fromStatus: "APPROVED",
    toStatus: "REVIEW",
    detail: { reason },
  });
  return next;
}

export type TextChange = {
  fieldId: string;
  text: string;
  sourceType?: CatalogValueSource;
};

/**
 * Writes text values for one language. Unchanged text is skipped. Changing source text clears
 * the approval on that field's translations, and they show as out of date until redone.
 */
export async function applyTextValues(input: {
  item: CatalogItem;
  fields: CatalogField[];
  values: CatalogValue[];
  languageCode: string;
  changes: TextChange[];
  sourceType: CatalogValueSource;
  approver: boolean;
}): Promise<{ changed: CatalogField[]; unapproved: number }> {
  const { item, fields, values, languageCode } = input;
  const isSource = languageCode === item.source_language;
  const actor = await getActor();
  const rows: Record<string, unknown>[] = [];
  const changed: CatalogField[] = [];
  let unapproved = 0;

  for (const change of input.changes) {
    const field = fields.find((f) => f.id === change.fieldId);
    if (!field) throw new Error("That field no longer exists. Reload the page.");
    if (!isSource && !field.translatable) {
      throw new Error(`${field.label} is the same in every language. Edit it in the source language.`);
    }
    // Keep inner line breaks (manual steps); drop blank edges.
    const text = change.text.replace(/\s+$/, "").replace(/^\s*\n/, "");
    const existing = values.find((v) => v.field_id === field.id && v.language_code === languageCode);
    if ((existing?.text_value ?? "") === text) continue;

    const sourceType = change.sourceType ?? input.sourceType;
    const status: TranslationStatus = !text.trim()
      ? "MISSING"
      : sourceType === "SYSTEM" || sourceType === "MEMORY"
        ? "SYSTEM_GENERATED"
        : manualSaveStatus(input.approver, existing?.status);
    const source = values.find((v) => v.field_id === field.id && v.language_code === item.source_language);
    const sourceHash = isSource
      ? text.trim()
        ? textHash(text)
        : null
      : source?.text_value.trim()
        ? source.source_hash ?? textHash(source.text_value)
        : null;
    const keepStamp = status === "APPROVED" && existing?.status === "APPROVED";

    rows.push({
      item_id: item.id,
      field_id: field.id,
      language_code: languageCode,
      text_value: text,
      status,
      source_type: sourceType,
      source_hash: sourceHash,
      updated_by_name: actor?.name ?? null,
      approved_by_username: keepStamp ? existing?.approved_by_username : null,
      approved_by_name: keepStamp ? existing?.approved_by_name : null,
      approved_by_user_id: keepStamp ? existing?.approved_by_user_id : null,
      approved_at: keepStamp ? existing?.approved_at : null,
    });
    changed.push(field);
    if (existing?.status === "APPROVED" && status !== "APPROVED") unapproved += 1;
  }

  if (rows.length === 0) return { changed, unapproved };

  const db = await getDb();
  const { error } = await db
    .from("catalog_values")
    .upsert(rows, { onConflict: "item_id,field_id,language_code" });
  if (error) throwItemError(error);

  const sourceFieldIds = isSource
    ? changed.filter((f) => f.translatable).map((f) => f.id)
    : [];
  if (sourceFieldIds.length > 0) {
    const { data, error: clearError } = await db
      .from("catalog_values")
      .update({
        status: "MANUALLY_MODIFIED",
        approved_by_username: null,
        approved_by_name: null,
        approved_by_user_id: null,
        approved_at: null,
      })
      .eq("item_id", item.id)
      .in("field_id", sourceFieldIds)
      .neq("language_code", item.source_language)
      .eq("status", "APPROVED")
      .select("id");
    if (clearError) throwItemError(clearError);
    unapproved += data?.length ?? 0;
  }

  return { changed, unapproved };
}

/** Fields added to the item but still empty in the source language. They block review and approval. */
export function missingRequired(fields: CatalogField[], values: CatalogValue[], item: CatalogItem): CatalogField[] {
  return itemFields(fields, values, item.source_language).filter(
    (field) =>
      !hasValue(values.find((v) => v.field_id === field.id && v.language_code === item.source_language))
  );
}

/**
 * Approves every value in one language and stores its text in translation memory.
 * A target language needs every translatable text field filled and up to date first.
 */
export async function approveLanguageValues(input: {
  item: CatalogItem;
  fields: CatalogField[];
  values: CatalogValue[];
  languageCode: string;
  userId: string;
}): Promise<number> {
  const { item, fields, values, languageCode } = input;
  const isSource = languageCode === item.source_language;
  const db = await getDb();

  if (!isSource) {
    const blockers: string[] = [];
    for (const field of fields) {
      if (field.status !== "ACTIVE" || !isMachineTranslatable(field)) continue;
      const source = values.find((v) => v.field_id === field.id && v.language_code === item.source_language);
      if (!source?.text_value.trim()) continue;
      const target = values.find((v) => v.field_id === field.id && v.language_code === languageCode);
      if (!target?.text_value.trim()) blockers.push(`${field.label} is empty`);
      else if (isStale(source, target)) blockers.push(`${field.label} was written from older source text`);
    }
    if (blockers.length > 0) {
      throw new Error(`${languageCode.toUpperCase()}: ${blockers.join(", ")}. Translate or save it first.`);
    }
  }

  const stamp = await approvalStamp("APPROVED", input.userId);
  const { data, error } = await db
    .from("catalog_values")
    .update({ status: "APPROVED", ...stamp })
    .eq("item_id", item.id)
    .eq("language_code", languageCode)
    .neq("status", "APPROVED")
    .neq("status", "MISSING")
    .select("id");
  if (error) throwItemError(error);

  if (!isSource) {
    const memory = fields
      .filter((field) => field.status === "ACTIVE" && isMachineTranslatable(field))
      .map((field) => {
        const source = values.find((v) => v.field_id === field.id && v.language_code === item.source_language);
        const target = values.find((v) => v.field_id === field.id && v.language_code === languageCode);
        if (!source?.text_value.trim() || !target?.text_value.trim()) return null;
        return {
          application_id: item.application_id,
          source_language: item.source_language,
          target_language: languageCode,
          source_hash: source.source_hash ?? textHash(source.text_value),
          source_text: source.text_value,
          translated_text: target.text_value,
          approved_by_name: stamp.approved_by_name,
          approved_by_username: stamp.approved_by_username,
          approved_at: stamp.approved_at,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row);
    if (memory.length > 0) {
      const { error: memoryError } = await db.from("translation_memory").upsert(memory, {
        onConflict: "application_id,source_language,target_language,source_hash",
      });
      if (memoryError) console.error("[translation_memory]", memoryError.message);
    }
  }

  return data?.length ?? 0;
}

/** Approves the source and every target language, then the item itself. */
export async function approveWholeItem(input: {
  item: CatalogItem;
  fields: CatalogField[];
  values: CatalogValue[];
  userId: string;
  reason: string;
}): Promise<CatalogItem> {
  const { item, fields, values } = input;
  const missing = missingRequired(fields, values, item);
  if (missing.length > 0) {
    throw new Error(`Fill or remove ${missing.map((f) => f.label).join(", ")} before approving.`);
  }
  for (const language of item.target_languages) {
    if (language === item.source_language) continue;
    if (languageProgress(fields, values, item.source_language, language).complete) continue;
    await approveLanguageValues({ item, fields, values, languageCode: language, userId: input.userId });
  }
  await approveLanguageValues({
    item,
    fields,
    values,
    languageCode: item.source_language,
    userId: input.userId,
  });
  const stamp = await approvalStamp("APPROVED", input.userId);
  const next = await updateItemStatus(item, "APPROVED", stamp);
  await recordItemEvent({
    item,
    event: "APPROVED",
    userId: input.userId,
    fromStatus: item.status,
    toStatus: "APPROVED",
    detail: { reason: input.reason },
  });
  return next;
}

export async function removeStoredFiles(paths: string[]): Promise<void> {
  const list = paths.filter(Boolean);
  if (list.length === 0) return;
  const db = await getDb();
  const { error } = await db.storage.from(CATALOG_BUCKET).remove(list);
  if (error) console.error("[catalog-files] remove", error.message);
}
