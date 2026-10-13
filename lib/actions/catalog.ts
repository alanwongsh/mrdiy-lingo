"use server";

import { revalidatePath } from "next/cache";
import { escapeIlike, getDb } from "@/lib/db/client";
import { getActor } from "@/lib/auth/actor";
import {
  requireAppCapability,
  requireItemAccess,
  requireItemValueAccess,
  type AccessGrant,
} from "@/lib/auth/access";
import {
  catalogTemplate,
  isMachineTranslatable,
  languageProgress,
  normalizeFieldCode,
  normalizeItemCode,
  type LanguageProgress,
} from "@/lib/catalog";
import {
  applyTextValues,
  approveLanguageValues,
  approveWholeItem,
  loadItem,
  loadItemFields,
  loadItemValues,
  missingRequired,
  recordItemEvent,
  removeStoredFiles,
  reopenIfApproved,
  revalidateItem,
  textHash,
  throwItemError,
  updateItemStatus,
  type TextChange,
} from "@/lib/catalog-store";
import { getTranslationService, type TranslationService } from "@/lib/translation/service";
import type {
  EntityStatus,
  Paginated,
  CatalogItem,
  CatalogEvent,
  CatalogField,
  ItemStatus,
  CatalogValue,
} from "@/lib/types";

/* ---------- Fields ---------- */

function revalidateFields(applicationId: string) {
  revalidatePath(`/applications/${applicationId}/fields`);
  revalidatePath(`/applications/${applicationId}/items`);
}

export async function listItemFields(
  applicationId: string,
  opts?: { includeInactive?: boolean }
): Promise<CatalogField[]> {
  await requireAppCapability(applicationId, "view");
  return loadItemFields(applicationId, opts);
}

export async function listItemFieldUsage(applicationId: string): Promise<Record<string, boolean>> {
  await requireAppCapability(applicationId, "view");
  const fields = await loadItemFields(applicationId, { includeInactive: true });
  const db = await getDb();
  const usage: Record<string, boolean> = {};
  for (const field of fields) {
    const { count, error } = await db
      .from("catalog_values")
      .select("id", { count: "exact", head: true })
      .eq("field_id", field.id);
    if (error) throwItemError(error);
    usage[field.id] = (count ?? 0) > 0;
  }
  return usage;
}

/** Adds the starter fields to a catalog that has no fields yet. */
export async function ensureCatalogFields(
  applicationId: string,
  templateCode?: string | null
): Promise<void> {
  await requireAppCapability(applicationId, "edit");
  const existing = await loadItemFields(applicationId, { includeInactive: true });
  if (existing.length > 0) return;
  const db = await getDb();
  const { error } = await db.from("catalog_fields").insert(
    catalogTemplate(templateCode).fields.map((field, index) => ({
      ...field,
      application_id: applicationId,
      sort_order: index * 10,
      status: "ACTIVE",
    }))
  );
  if (error && error.code !== "23505") throwItemError(error);
  revalidateFields(applicationId);
}

function cleanFieldInput(input: { label: string; translatable: boolean }) {
  const label = input.label.trim();
  if (!label) throw new Error("Label is required.");
  return { label, translatable: !!input.translatable };
}

export async function createItemField(input: {
  application_id: string;
  label: string;
  code?: string;
  translatable: boolean;
  required: boolean;
}): Promise<CatalogField> {
  await requireAppCapability(input.application_id, "settings.fields");
  const { label, translatable } = cleanFieldInput(input);
  const code = normalizeFieldCode(input.code?.trim() ? input.code : label);
  if (!code) throw new Error("Enter a label that can become a field code.");
  const existing = await loadItemFields(input.application_id, { includeInactive: true });
  if (existing.some((f) => f.code === code)) throw new Error(`Field ${code} already exists.`);
  const sortOrder = Math.max(-10, ...existing.map((f) => f.sort_order)) + 10;
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_fields")
    .insert({
      application_id: input.application_id,
      code,
      label,
      // Kept for older rows; every field takes text and an upload.
      field_type: "long_text",
      translatable,
      required: !!input.required,
      sort_order: sortOrder,
      status: "ACTIVE",
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`Field ${code} already exists.`);
    throwItemError(error);
  }
  revalidateFields(input.application_id);
  return data as CatalogField;
}

export async function updateItemField(
  id: string,
  applicationId: string,
  input: {
    label: string;
    translatable: boolean;
    required: boolean;
    sort_order: number;
    status: EntityStatus;
  }
): Promise<CatalogField> {
  await requireAppCapability(applicationId, "settings.fields");
  const { label, translatable } = cleanFieldInput(input);
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_fields")
    .update({
      label,
      translatable,
      required: !!input.required,
      sort_order: Number.isFinite(input.sort_order) ? Math.round(input.sort_order) : 0,
      status: input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    })
    .eq("id", id)
    .eq("application_id", applicationId)
    .select("*")
    .single();
  if (error) throwItemError(error);
  revalidateFields(applicationId);
  return data as CatalogField;
}

export async function deleteItemField(id: string, applicationId: string): Promise<void> {
  await requireAppCapability(applicationId, "settings.fields");
  const db = await getDb();
  const { error } = await db
    .from("catalog_fields")
    .delete()
    .eq("id", id)
    .eq("application_id", applicationId);
  if (error) {
    if (error.code === "23503") {
      throw new Error("Items already use this field. Mark it inactive instead.");
    }
    throwItemError(error);
  }
  revalidateFields(applicationId);
}

/* ---------- Items ---------- */

export type ItemListItem = CatalogItem & {
  progress: Record<string, LanguageProgress>;
};

export async function listItems(input: {
  applicationId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ItemStatus | "";
}): Promise<Paginated<ItemListItem>> {
  await requireAppCapability(input.applicationId, "view");
  const db = await getDb();
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const from = (page - 1) * pageSize;

  let query = db
    .from("catalog_items")
    .select("*", { count: "exact" })
    .eq("application_id", input.applicationId)
    .order("updated_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (input.status) query = query.eq("status", input.status);
  const term = input.search?.trim().replace(/[,()]/g, " ").trim();
  if (term) {
    const like = escapeIlike(term);
    query = query.or(`item_code.ilike.%${like}%,name.ilike.%${like}%`);
  }
  const { data, error, count } = await query;
  if (error) throwItemError(error);
  const items = (data ?? []) as CatalogItem[];

  const [fields, values] = await Promise.all([
    loadItemFields(input.applicationId),
    loadItemValues(items.map((s) => s.id)),
  ]);
  const rows = items.map((item) => {
    const own = values.filter((v) => v.item_id === item.id);
    const progress: Record<string, LanguageProgress> = {};
    for (const language of item.target_languages) {
      progress[language] = languageProgress(fields, own, item.source_language, language);
    }
    return { ...item, progress };
  });

  return { items: rows, total: count ?? rows.length, page, pageSize };
}

export async function countItemsByStatus(
  applicationId: string
): Promise<Record<ItemStatus, number>> {
  await requireAppCapability(applicationId, "view");
  const db = await getDb();
  const statuses: ItemStatus[] = ["DRAFT", "REVIEW", "CHANGES_REQUESTED", "APPROVED"];
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await db
        .from("catalog_items")
        .select("id", { count: "exact", head: true })
        .eq("application_id", applicationId)
        .eq("status", status);
      if (error) throwItemError(error);
      return [status, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts) as Record<ItemStatus, number>;
}

export type ItemDetail = {
  item: CatalogItem;
  fields: CatalogField[];
  values: CatalogValue[];
  events: CatalogEvent[];
};

export async function getItemDetail(itemId: string): Promise<ItemDetail | null> {
  const item = await loadItem(itemId);
  if (!item) return null;
  await requireAppCapability(item.application_id, "view");
  const db = await getDb();
  const [fields, values, events] = await Promise.all([
    loadItemFields(item.application_id),
    loadItemValues([item.id]),
    db
      .from("catalog_events")
      .select("*")
      .eq("item_id", item.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (events.error) throwItemError(events.error);
  return { item, fields, values, events: (events.data ?? []) as CatalogEvent[] };
}

function cleanTargets(targets: string[], sourceLanguage: string): string[] {
  return [...new Set(targets.map((t) => t.trim()).filter(Boolean))].filter(
    (code) => code !== sourceLanguage
  );
}

export async function createItem(input: {
  applicationId: string;
  item_code: string;
  name: string;
  source_language: string;
  target_languages: string[];
  values?: Record<string, string>;
}): Promise<CatalogItem> {
  const grant = await requireAppCapability(input.applicationId, "edit");
  const code = normalizeItemCode(input.item_code);
  if (!code) throw new Error("Code is required.");
  if (!input.source_language) throw new Error("Pick the source language.");
  const actor = await getActor();
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_items")
    .insert({
      application_id: input.applicationId,
      item_code: code,
      name: input.name.trim(),
      source_language: input.source_language,
      target_languages: cleanTargets(input.target_languages, input.source_language),
      status: "DRAFT",
      created_by_name: actor?.name ?? null,
      created_by_username: actor?.username ?? null,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`${code} already exists.`);
    throwItemError(error);
  }
  const item = data as CatalogItem;
  const changes = Object.entries(input.values ?? {}).map(([fieldId, text]) => ({ fieldId, text }));
  if (changes.length > 0) {
    const fields = await loadItemFields(item.application_id);
    await applyTextValues({
      item,
      fields,
      values: [],
      languageCode: item.source_language,
      changes,
      sourceType: "MANUAL",
      approver: grant.access.can_approve,
    });
  }
  await recordItemEvent({ item, event: "CREATED", userId: grant.user.id, toStatus: "DRAFT" });
  revalidateItem(item.application_id);
  return item;
}

export async function updateItemDetails(
  itemId: string,
  input: { name: string; target_languages: string[] }
): Promise<CatalogItem> {
  const grant = await requireItemAccess(itemId, "edit");
  const item = await loadItem(itemId);
  if (!item) throw new Error("Item not found.");
  const targets = cleanTargets(input.target_languages, item.source_language);
  const name = input.name.trim();
  const changed: string[] = [];
  if (name !== item.name) changed.push("name");
  if (targets.join(",") !== item.target_languages.join(",")) changed.push("target languages");
  if (changed.length === 0) return item;
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_items")
    .update({ name, target_languages: targets })
    .eq("id", item.id)
    .select("*")
    .single();
  if (error) throwItemError(error);
  let next = data as CatalogItem;
  await recordItemEvent({ item, event: "EDITED", userId: grant.user.id, detail: { fields: changed } });
  // A new language has nothing approved yet.
  const added = targets.filter((t) => !item.target_languages.includes(t));
  if (added.length > 0) {
    next = await reopenIfApproved(next, `Added ${added.join(", ").toUpperCase()}`, grant.user.id);
  }
  revalidateItem(item.application_id, item.id);
  return next;
}

export async function saveItemText(input: {
  itemId: string;
  languageCode: string;
  changes: TextChange[];
}): Promise<{ saved: number }> {
  const grant = await requireItemAccess(input.itemId, "edit");
  const item = await loadItem(input.itemId);
  if (!item) throw new Error("Item not found.");
  if (
    input.languageCode !== item.source_language &&
    !item.target_languages.includes(input.languageCode)
  ) {
    throw new Error("Add this language to this item first.");
  }
  const [fields, values] = await Promise.all([
    loadItemFields(item.application_id),
    loadItemValues([item.id]),
  ]);
  const result = await applyTextValues({
    item,
    fields,
    values,
    languageCode: input.languageCode,
    changes: input.changes.map(({ fieldId, text }) => ({ fieldId, text })),
    sourceType: "MANUAL",
    approver: grant.access.can_approve,
  });
  if (result.changed.length > 0) {
    await recordItemEvent({
      item,
      event: "EDITED",
      userId: grant.user.id,
      languageCode: input.languageCode,
      detail: { fields: result.changed.map((f) => f.label) },
    });
    if (result.unapproved > 0) {
      await reopenIfApproved(
        item,
        input.languageCode === item.source_language ? "Source text changed" : "Translation edited",
        grant.user.id
      );
    }
  }
  revalidateItem(item.application_id, item.id);
  return { saved: result.changed.length };
}

/* ---------- Translation ---------- */

export type TranslateStats = {
  items: number;
  /** Values written. */
  written: number;
  /** Requests sent to the translation provider. */
  providerCalls: number;
  /** Filled from approved translation memory. */
  fromMemory: number;
  /** Same text earlier in this run, translated once. */
  fromBatch: number;
  /** Kept because a person already wrote or approved it. */
  kept: number;
  failed: number;
};

function emptyStats(): TranslateStats {
  return { items: 0, written: 0, providerCalls: 0, fromMemory: 0, fromBatch: 0, kept: 0, failed: 0 };
}

async function translateOneItem(input: {
  item: CatalogItem;
  fields: CatalogField[];
  values: CatalogValue[];
  languages: string[];
  service: TranslationService;
  batch: Map<string, string>;
  stats: TranslateStats;
  grant: AccessGrant;
}) {
  const { item, fields, values, service, batch, stats } = input;
  const languages = input.languages.filter(
    (l) => l !== item.source_language && item.target_languages.includes(l)
  );
  const sources = fields
    .filter((f) => isMachineTranslatable(f))
    .map((field) => {
      const source = values.find((v) => v.field_id === field.id && v.language_code === item.source_language);
      const text = source?.text_value ?? "";
      return { field, text, hash: text.trim() ? source?.source_hash ?? textHash(text) : "" };
    })
    .filter((s) => s.hash);
  if (languages.length === 0 || sources.length === 0) return;

  const db = await getDb();
  const { data: memoryRows, error } = await db
    .from("translation_memory")
    .select("target_language, source_hash, translated_text")
    .eq("application_id", item.application_id)
    .eq("source_language", item.source_language)
    .in("target_language", languages)
    .in("source_hash", [...new Set(sources.map((s) => s.hash))]);
  if (error) throwItemError(error);
  const memory = new Map(
    (memoryRows ?? []).map((row) => [`${row.target_language}|${row.source_hash}`, row.translated_text as string])
  );

  let written = 0;
  for (const language of languages) {
    const changes: TextChange[] = [];
    for (const { field, text, hash } of sources) {
      const target = values.find((v) => v.field_id === field.id && v.language_code === language);
      const current = !!target?.text_value.trim() && target.source_hash === hash;
      if (target && current && (target.status === "APPROVED" || target.status === "MANUALLY_MODIFIED")) {
        stats.kept += 1;
        continue;
      }
      const remembered = memory.get(`${language}|${hash}`);
      if (remembered !== undefined) {
        stats.fromMemory += 1;
        changes.push({ fieldId: field.id, text: remembered, sourceType: "MEMORY" });
        continue;
      }
      const batchKey = `${item.source_language}|${language}|${hash}`;
      const cached = batch.get(batchKey);
      if (cached !== undefined) {
        stats.fromBatch += 1;
        changes.push({ fieldId: field.id, text: cached, sourceType: "SYSTEM" });
        continue;
      }
      try {
        stats.providerCalls += 1;
        const translated = await service.translateText({
          text,
          sourceLanguage: item.source_language,
          targetLanguage: language,
        });
        if (!translated.trim()) throw new Error("Empty translation");
        batch.set(batchKey, translated);
        changes.push({ fieldId: field.id, text: translated, sourceType: "SYSTEM" });
      } catch (err) {
        stats.failed += 1;
        console.error("[item translate]", item.item_code, field.code, language, err);
      }
    }
    if (changes.length === 0) continue;
    const result = await applyTextValues({
      item,
      fields,
      values,
      languageCode: language,
      changes,
      sourceType: "SYSTEM",
      approver: false,
    });
    written += result.changed.length;
  }

  stats.written += written;
  stats.items += 1;
  if (written > 0) {
    await recordItemEvent({
      item,
      event: "TRANSLATED",
      userId: input.grant.user.id,
      detail: { languages, values: written },
    });
    // Machine text is never approved, so an approved item needs review again.
    await reopenIfApproved(item, "Machine translation added", input.grant.user.id);
  }
}

export async function translateItem(input: {
  itemId: string;
  languages?: string[];
}): Promise<TranslateStats> {
  const grant = await requireItemAccess(input.itemId, "edit");
  const item = await loadItem(input.itemId);
  if (!item) throw new Error("Item not found.");
  const [fields, values] = await Promise.all([
    loadItemFields(item.application_id),
    loadItemValues([item.id]),
  ]);
  const stats = emptyStats();
  await translateOneItem({
    item,
    fields,
    values,
    languages: input.languages?.length ? input.languages : item.target_languages,
    service: getTranslationService(item.application_id),
    batch: new Map(),
    stats,
    grant,
  });
  revalidateItem(item.application_id, item.id);
  return stats;
}

/** Translates up to 50 items. Identical source text is translated once and reused. */
export async function translateItems(input: {
  applicationId: string;
  itemIds: string[];
}): Promise<TranslateStats> {
  const grant = await requireAppCapability(input.applicationId, "edit");
  const ids = [...new Set(input.itemIds)].slice(0, 50);
  if (ids.length === 0) return emptyStats();
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_items")
    .select("*")
    .eq("application_id", input.applicationId)
    .in("id", ids);
  if (error) throwItemError(error);
  const items = (data ?? []) as CatalogItem[];
  const [fields, values] = await Promise.all([
    loadItemFields(input.applicationId),
    loadItemValues(items.map((s) => s.id)),
  ]);
  const stats = emptyStats();
  const batch = new Map<string, string>();
  const service = getTranslationService(input.applicationId);
  for (const item of items) {
    await translateOneItem({
      item,
      fields,
      values: values.filter((v) => v.item_id === item.id),
      languages: item.target_languages,
      service,
      batch,
      stats,
      grant,
    });
  }
  revalidateItem(input.applicationId);
  return stats;
}

/* ---------- Approval workflow ---------- */

export async function submitItem(itemId: string): Promise<CatalogItem> {
  const grant = await requireItemAccess(itemId, "edit");
  const item = await loadItem(itemId);
  if (!item) throw new Error("Item not found.");
  if (item.status === "REVIEW") return item;
  if (item.status === "APPROVED") throw new Error("This item is already approved.");
  const [fields, values] = await Promise.all([
    loadItemFields(item.application_id),
    loadItemValues([item.id]),
  ]);
  const missing = missingRequired(fields, values, item);
  if (missing.length > 0) {
    throw new Error(`Fill ${missing.map((f) => f.label).join(", ")} before submitting.`);
  }
  const actor = await getActor();
  const next = await updateItemStatus(item, "REVIEW", {
    submitted_by_name: actor?.name ?? null,
    submitted_by_username: actor?.username ?? null,
    submitted_at: new Date().toISOString(),
  });
  await recordItemEvent({
    item,
    event: "SUBMITTED",
    userId: grant.user.id,
    fromStatus: item.status,
    toStatus: "REVIEW",
  });
  revalidateItem(item.application_id, item.id);
  return next;
}

export async function approveItemLanguage(input: {
  itemId: string;
  languageCode: string;
}): Promise<CatalogItem> {
  const grant = await requireItemAccess(input.itemId, "approve");
  const item = await loadItem(input.itemId);
  if (!item) throw new Error("Item not found.");
  if (!item.target_languages.includes(input.languageCode)) {
    throw new Error("That language is not a target of this item.");
  }
  const fields = await loadItemFields(item.application_id);
  const values = await loadItemValues([item.id]);
  await approveLanguageValues({
    item,
    fields,
    values,
    languageCode: input.languageCode,
    userId: grant.user.id,
  });
  await recordItemEvent({
    item,
    event: "LANGUAGE_APPROVED",
    userId: grant.user.id,
    languageCode: input.languageCode,
  });

  let next = item;
  const after = await loadItemValues([item.id]);
  const allDone = item.target_languages.every(
    (language) => languageProgress(fields, after, item.source_language, language).complete
  );
  if (allDone && item.status !== "APPROVED" && missingRequired(fields, after, item).length === 0) {
    next = await approveWholeItem({
      item,
      fields,
      values: after,
      userId: grant.user.id,
      reason: "Every language approved",
    });
  }
  revalidateItem(item.application_id, item.id);
  return next;
}

export async function approveItem(itemId: string): Promise<CatalogItem> {
  const grant = await requireItemAccess(itemId, "approve");
  const item = await loadItem(itemId);
  if (!item) throw new Error("Item not found.");
  if (item.status === "APPROVED") return item;
  const [fields, values] = await Promise.all([
    loadItemFields(item.application_id),
    loadItemValues([item.id]),
  ]);
  const next = await approveWholeItem({
    item,
    fields,
    values,
    userId: grant.user.id,
    reason: "Approved by reviewer",
  });
  revalidateItem(item.application_id, item.id);
  return next;
}

export async function requestItemChanges(input: {
  itemId: string;
  comment: string;
}): Promise<CatalogItem> {
  const grant = await requireItemAccess(input.itemId, "approve");
  const comment = input.comment.trim();
  if (!comment) throw new Error("Say what needs to change.");
  const item = await loadItem(input.itemId);
  if (!item) throw new Error("Item not found.");
  if (item.status === "DRAFT") throw new Error("This item has not been submitted yet.");
  const next = await updateItemStatus(item, "CHANGES_REQUESTED", {
    approved_by_name: null,
    approved_by_username: null,
    approved_by_user_id: null,
    approved_at: null,
  });
  await recordItemEvent({
    item,
    event: "CHANGES_REQUESTED",
    userId: grant.user.id,
    fromStatus: item.status,
    toStatus: "CHANGES_REQUESTED",
    comment: comment.slice(0, 2000),
  });
  revalidateItem(item.application_id, item.id);
  return next;
}

export async function deleteItem(itemId: string): Promise<void> {
  const grant = await requireItemAccess(itemId, "edit");
  const item = await loadItem(itemId);
  if (!item) return;
  const values = await loadItemValues([item.id]);
  const db = await getDb();
  const { error } = await db.from("catalog_items").delete().eq("id", item.id);
  if (error) throwItemError(error);
  await removeStoredFiles(values.map((v) => v.file_path ?? ""));
  await recordItemEvent({ item, event: "DELETED", userId: grant.user.id, fromStatus: item.status });
  revalidateItem(item.application_id);
}

export async function deleteItemFile(valueId: string): Promise<void> {
  const grant = await requireItemValueAccess(valueId, "edit");
  const item = await loadItem(grant.itemId);
  if (!item) throw new Error("Item not found.");
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_values")
    .select("file_path, file_name, language_code, text_value")
    .eq("id", valueId)
    .maybeSingle();
  if (error) throwItemError(error);
  if (!data?.file_path) return;
  // The row also holds the field's text; keep it and clear only the file.
  const cleared = data.text_value.trim()
    ? await db
        .from("catalog_values")
        .update({ file_path: null, file_name: null, file_mime: null, file_size: null })
        .eq("id", valueId)
    : await db.from("catalog_values").delete().eq("id", valueId);
  if (cleared.error) throwItemError(cleared.error);
  await removeStoredFiles([data.file_path]);
  await recordItemEvent({
    item,
    event: "EDITED",
    userId: grant.user.id,
    languageCode: data?.language_code ?? null,
    detail: { removed: data?.file_name ?? "file" },
  });
  await reopenIfApproved(item, "File removed", grant.user.id);
  revalidateItem(item.application_id, item.id);
}
