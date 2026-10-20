"use server";

import { UserFacingError } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { requireAppCapability } from "@/lib/auth/access";
import { toneSchemaMissing } from "@/lib/tone-store";
import { normalizeToneCode } from "@/lib/tones";
import type { EntityStatus, ToneProfile } from "@/lib/types";

function throwToneError(error: { message: string; code?: string }): never {
  if (toneSchemaMissing(error)) {
    throw new Error("Run migration 034_tone_profiles.sql before managing tones.");
  }
  throw new Error(error.message);
}

function revalidateTones(applicationId: string) {
  revalidatePath(`/applications/${applicationId}/articles`);
  revalidatePath(`/applications/${applicationId}/settings/general`);
}

/** Trimmed notes, without blank languages. */
function cleanNotes(notes: Record<string, string> | undefined) {
  const out: Record<string, string> = {};
  for (const [code, note] of Object.entries(notes ?? {})) {
    const key = code.trim();
    const value = note.trim();
    if (key && value) out[key] = value.slice(0, 2000);
  }
  return out;
}

function mapTone(row: ToneProfile): ToneProfile {
  return {
    ...row,
    instructions: row.instructions ?? "",
    language_notes:
      row.language_notes && typeof row.language_notes === "object" ? row.language_notes : {},
    allow_adaptation: Boolean(row.allow_adaptation),
  };
}

/** Empty before migration 034, so pages still load. */
export async function listTones(
  applicationId: string,
  opts?: { includeInactive?: boolean }
): Promise<ToneProfile[]> {
  await requireAppCapability(applicationId, "view");
  const db = await getDb();
  let query = db
    .from("tone_profiles")
    .select("*")
    .eq("application_id", applicationId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!opts?.includeInactive) query = query.eq("status", "ACTIVE");
  const { data, error } = await query;
  if (error) {
    if (toneSchemaMissing(error)) return [];
    throwToneError(error);
  }
  return ((data ?? []) as ToneProfile[]).map(mapTone);
}

type ToneInput = {
  name: string;
  instructions: string;
  language_notes: Record<string, string>;
  allow_adaptation: boolean;
};

export async function createTone(
  input: ToneInput & { application_id: string; code?: string }
): Promise<ToneProfile> {
  await requireAppCapability(input.application_id, "settings.content_types");
  const name = input.name.trim();
  if (!name) throw new UserFacingError("Name is required.");
  const code = normalizeToneCode(input.code?.trim() ? input.code : name);
  if (!code) throw new UserFacingError("Enter a name that can become a tone code.");
  const db = await getDb();
  const { data: last, error: lastError } = await db
    .from("tone_profiles")
    .select("sort_order")
    .eq("application_id", input.application_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) throwToneError(lastError);
  const current = last?.[0]?.sort_order;
  const { data, error } = await db
    .from("tone_profiles")
    .insert({
      application_id: input.application_id,
      code,
      name,
      instructions: input.instructions.trim(),
      language_notes: cleanNotes(input.language_notes),
      allow_adaptation: Boolean(input.allow_adaptation),
      status: "ACTIVE",
      sort_order: typeof current === "number" ? current + 1 : 0,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new UserFacingError(`Tone ${code} already exists.`);
    throwToneError(error);
  }
  revalidateTones(input.application_id);
  return mapTone(data as ToneProfile);
}

export async function updateTone(
  id: string,
  applicationId: string,
  input: ToneInput & { status: EntityStatus }
): Promise<ToneProfile> {
  await requireAppCapability(applicationId, "settings.content_types");
  const name = input.name.trim();
  if (!name) throw new UserFacingError("Name is required.");
  const db = await getDb();
  const { data, error } = await db
    .from("tone_profiles")
    .update({
      name,
      instructions: input.instructions.trim(),
      language_notes: cleanNotes(input.language_notes),
      allow_adaptation: Boolean(input.allow_adaptation),
      status: input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    })
    .eq("id", id)
    .eq("application_id", applicationId)
    .select("*")
    .single();
  if (error) throwToneError(error);
  revalidateTones(applicationId);
  return mapTone(data as ToneProfile);
}

/** Only an unused tone can be deleted. A used one is marked inactive instead. */
export async function deleteTone(id: string, applicationId: string) {
  await requireAppCapability(applicationId, "settings.content_types");
  const db = await getDb();
  const { data: tone, error: findError } = await db
    .from("tone_profiles")
    .select("code")
    .eq("id", id)
    .eq("application_id", applicationId)
    .maybeSingle();
  if (findError) throwToneError(findError);
  if (!tone) return;
  const [articles, types] = await Promise.all([
    db
      .from("content")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .eq("tone", tone.code),
    db
      .from("content_types")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .eq("default_tone", tone.code),
  ]);
  if (articles.error) throwToneError(articles.error);
  if (types.error) throwToneError(types.error);
  if ((articles.count ?? 0) > 0 || (types.count ?? 0) > 0) {
    throw new UserFacingError(
      "This tone is used by articles or article types. Mark it inactive instead."
    );
  }
  const { error } = await db
    .from("tone_profiles")
    .delete()
    .eq("id", id)
    .eq("application_id", applicationId);
  if (error) throwToneError(error);
  revalidateTones(applicationId);
}
