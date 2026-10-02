"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import type { EntityStatus, Language } from "@/lib/types";

export async function listLanguages(opts?: {
  includeInactive?: boolean;
}): Promise<Language[]> {
  const db = await getDb();
  let query = db.from("languages").select("*").order("name", { ascending: true });
  if (!opts?.includeInactive) {
    query = query.eq("status", "ACTIVE");
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Language[];
}

export async function createLanguage(input: {
  code: string;
  name: string;
}): Promise<Language> {
  const db = await getDb();
  const { data, error } = await db
    .from("languages")
    .insert({
      code: input.code.trim(),
      name: input.name.trim(),
      status: "ACTIVE",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/languages");
  revalidatePath("/");
  return data as Language;
}

export async function updateLanguage(
  id: string,
  input: { code: string; name: string; status: EntityStatus }
): Promise<Language> {
  const db = await getDb();
  const { data, error } = await db
    .from("languages")
    .update({
      code: input.code.trim(),
      name: input.name.trim(),
      status: input.status,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/languages");
  revalidatePath("/");
  return data as Language;
}

export async function setLanguageStatus(
  id: string,
  status: EntityStatus
): Promise<void> {
  const db = await getDb();
  const { error } = await db.from("languages").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/languages");
  revalidatePath("/");
}
