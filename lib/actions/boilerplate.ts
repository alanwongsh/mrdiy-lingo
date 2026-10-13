"use server";

import { revalidatePath } from "next/cache";
import { requireAppCapability } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";

/**
 * One standard passage, such as the company introduction, in every language it has.
 * Rows in boilerplate_phrases share a name across languages; the quality check and
 * auto-translate match them by that name.
 */
export type BoilerplateSet = {
  name: string;
  isActive: boolean;
  /** Language code to the approved wording. */
  phrases: Record<string, string>;
};

const MIGRATION = "Run migration 028_boilerplate_per_application.sql from Setup.";
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function throwBoilerplateError(error: { message: string; code?: string }): never {
  if (error.code === "42703" || error.code === "42P01") throw new Error(MIGRATION);
  if (error.code === "23505") throw new Error("That name is already used for another passage.");
  throw new Error(error.message);
}

function revalidate(applicationId: string) {
  revalidatePath(`/applications/${applicationId}/settings/quality`);
}

/** Names are used to match languages, so keep them simple and comparable. */
function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new Error("Enter a name of up to 80 characters.");
  return name;
}

export async function listBoilerplate(applicationId: string): Promise<BoilerplateSet[]> {
  await requireAppCapability(applicationId, "view");
  const db = await getDb();
  const { data, error } = await db
    .from("boilerplate_phrases")
    .select("name, language, phrase, is_active")
    .eq("application_id", applicationId)
    .order("name");
  if (error) throwBoilerplateError(error);
  const sets = new Map<string, BoilerplateSet>();
  for (const row of data ?? []) {
    const key = (row.name as string).toLowerCase();
    const set = sets.get(key) ?? { name: row.name as string, isActive: false, phrases: {} };
    set.phrases[row.language as string] = row.phrase as string;
    set.isActive ||= !!row.is_active;
    sets.set(key, set);
  }
  return [...sets.values()];
}

/**
 * Create or replace one passage. Languages left blank are removed from it.
 * originalName is the name before an edit, or null for a new passage.
 */
export async function saveBoilerplate(input: {
  applicationId: string;
  originalName: string | null;
  name: string;
  isActive: boolean;
  phrases: Record<string, string>;
}): Promise<void> {
  await requireAppCapability(input.applicationId, "settings.boilerplate");
  const name = cleanName(input.name);
  const rows = Object.entries(input.phrases)
    .map(([language, phrase]) => ({ language: language.trim(), phrase: phrase.trim() }))
    .filter((row) => row.phrase);
  if (rows.length === 0) throw new Error("Enter the wording in at least one language.");
  for (const row of rows) {
    if (!LANGUAGE.test(row.language)) throw new Error("Choose a valid language.");
    if (row.phrase.length > 4000) throw new Error("A passage can be up to 4,000 characters.");
  }

  const db = await getDb();
  const existing = await db
    .from("boilerplate_phrases")
    .select("name")
    .eq("application_id", input.applicationId)
    .ilike("name", name.replace(/[%_\\]/g, (match) => `\\${match}`))
    .limit(1);
  if (existing.error) throwBoilerplateError(existing.error);
  const renamingOnto =
    (existing.data?.length ?? 0) > 0 &&
    name.toLowerCase() !== (input.originalName ?? "").toLowerCase();
  if (renamingOnto) throw new Error("That name is already used for another passage.");

  if (input.originalName) {
    const { error } = await db
      .from("boilerplate_phrases")
      .delete()
      .eq("application_id", input.applicationId)
      .ilike("name", input.originalName.replace(/[%_\\]/g, (match) => `\\${match}`));
    if (error) throwBoilerplateError(error);
  }
  const { error } = await db.from("boilerplate_phrases").insert(
    rows.map((row) => ({
      application_id: input.applicationId,
      name,
      language: row.language,
      phrase: row.phrase,
      expected_usage: "when_source_present",
      is_active: input.isActive,
    }))
  );
  if (error) throwBoilerplateError(error);
  revalidate(input.applicationId);
}

export async function deleteBoilerplate(input: {
  applicationId: string;
  name: string;
}): Promise<void> {
  await requireAppCapability(input.applicationId, "settings.boilerplate");
  const db = await getDb();
  const { error } = await db
    .from("boilerplate_phrases")
    .delete()
    .eq("application_id", input.applicationId)
    .ilike("name", input.name.replace(/[%_\\]/g, (match) => `\\${match}`));
  if (error) throwBoilerplateError(error);
  revalidate(input.applicationId);
}
