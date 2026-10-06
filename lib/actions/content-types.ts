"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import {
  contentTypeNameFromCode,
  DEFAULT_CONTENT_TYPE_CODE,
  normalizeContentTypeCode,
} from "@/lib/content-types";
import type { ContentTypeRecord, EntityStatus } from "@/lib/types";
import { requireAppCapability } from "@/lib/auth/access";

function throwContentTypeError(error: { message: string }) {
  if (
    /content_types/i.test(error.message) &&
    /does not exist|schema cache|Could not find/i.test(error.message)
  ) {
    throw new Error(
      "Run migration 013_content_types.sql from Setup before managing content types."
    );
  }
  throw new Error(error.message);
}

function revalidateContentTypes(applicationId: string) {
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/articles`);
  revalidatePath(`/applications/${applicationId}/types`);
}

async function findContentType(applicationId: string, code: string) {
  const db = await getDb();
  const { data, error } = await db
    .from("content_types")
    .select("*")
    .eq("application_id", applicationId)
    .eq("code", code)
    .maybeSingle();
  if (error) throwContentTypeError(error);
  return (data as ContentTypeRecord | null) ?? null;
}

export async function listContentTypes(
  applicationId: string,
  opts?: { includeInactive?: boolean }
): Promise<ContentTypeRecord[]> {
  await requireAppCapability(applicationId, "view");
  const db = await getDb();
  let query = db
    .from("content_types")
    .select("*")
    .eq("application_id", applicationId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!opts?.includeInactive) {
    query = query.eq("status", "ACTIVE");
  }
  const { data, error } = await query;
  if (error) throwContentTypeError(error);
  return (data ?? []) as ContentTypeRecord[];
}

export async function listContentTypeCounts(
  applicationId: string
): Promise<Record<string, number>> {
  await requireAppCapability(applicationId, "view");
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select("content_type")
    .eq("application_id", applicationId);
  if (error) throwContentTypeError(error);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const code = String(row.content_type ?? "");
    if (!code) continue;
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

async function nextSortOrder(applicationId: string) {
  const db = await getDb();
  const { data, error } = await db
    .from("content_types")
    .select("sort_order")
    .eq("application_id", applicationId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throwContentTypeError(error);
  const current = data?.[0]?.sort_order;
  return typeof current === "number" ? current + 1 : 0;
}

async function insertContentType(input: {
  applicationId: string;
  code: string;
  name: string;
  description?: string;
}) {
  const db = await getDb();
  const sort_order = await nextSortOrder(input.applicationId);
  const { data, error } = await db
    .from("content_types")
    .insert({
      application_id: input.applicationId,
      code: input.code,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      status: "ACTIVE",
      sort_order,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      const existing = await findContentType(input.applicationId, input.code);
      if (existing) return { record: existing, created: false as const };
    }
    throwContentTypeError(error);
  }
  return { record: data as ContentTypeRecord, created: true as const };
}

/** Creates a missing type. An existing code is reused, including when inactive. */
export async function ensureContentType(
  applicationId: string,
  raw: string | null | undefined
): Promise<{ code: string; created: boolean }> {
  await requireAppCapability(applicationId, "edit");
  const code =
    normalizeContentTypeCode(raw ?? "") || DEFAULT_CONTENT_TYPE_CODE;
  const existing = await findContentType(applicationId, code);
  if (existing) return { code: existing.code, created: false };
  const inserted = await insertContentType({
    applicationId,
    code,
    name: contentTypeNameFromCode(code),
  });
  if (inserted.created) revalidateContentTypes(applicationId);
  return { code: inserted.record.code, created: inserted.created };
}

export async function ensureDefaultContentType(applicationId: string) {
  return ensureContentType(applicationId, DEFAULT_CONTENT_TYPE_CODE);
}

/** Accepts an existing type. A blank value uses General, creating it when needed. */
export async function requireContentTypeCode(
  applicationId: string,
  raw: string | null | undefined
): Promise<string> {
  const requested = normalizeContentTypeCode(raw ?? "");
  if (!requested) {
    return (await ensureContentType(applicationId, DEFAULT_CONTENT_TYPE_CODE))
      .code;
  }
  await requireAppCapability(applicationId, "edit");
  const existing = await findContentType(applicationId, requested);
  if (!existing) {
    throw new Error(`Add the ${requested} type before using it.`);
  }
  return existing.code;
}

export async function createContentType(input: {
  application_id: string;
  name: string;
  code?: string;
  description?: string;
}): Promise<ContentTypeRecord> {
  await requireAppCapability(input.application_id, "edit");
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const code = normalizeContentTypeCode(input.code?.trim() ? input.code : name);
  if (!code) throw new Error("Enter a name that can become a type code.");
  const existing = await findContentType(input.application_id, code);
  if (existing) throw new Error(`Type ${code} already exists.`);
  const inserted = await insertContentType({
    applicationId: input.application_id,
    code,
    name,
    description: input.description,
  });
  if (!inserted.created) throw new Error(`Type ${code} already exists.`);
  revalidateContentTypes(input.application_id);
  return inserted.record;
}

export async function updateContentType(
  id: string,
  applicationId: string,
  input: { name: string; description: string; status: EntityStatus }
): Promise<ContentTypeRecord> {
  await requireAppCapability(applicationId, "edit");
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const status = input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const db = await getDb();
  const { data, error } = await db
    .from("content_types")
    .update({
      name,
      description: input.description.trim(),
      status,
    })
    .eq("id", id)
    .eq("application_id", applicationId)
    .select("*")
    .single();
  if (error) throwContentTypeError(error);
  revalidateContentTypes(applicationId);
  return data as ContentTypeRecord;
}

export async function deleteContentType(id: string, applicationId: string) {
  await requireAppCapability(applicationId, "edit");
  const db = await getDb();
  const { error } = await db
    .from("content_types")
    .delete()
    .eq("id", id)
    .eq("application_id", applicationId);
  if (error) {
    if (error.code === "23503" || /foreign key/i.test(error.message)) {
      throw new Error(
        "This type is used by articles. Mark it inactive instead."
      );
    }
    throwContentTypeError(error);
  }
  revalidateContentTypes(applicationId);
}
