"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import type {
  Application,
  ApplicationModelType,
  EntityStatus,
} from "@/lib/types";

export async function listApplications(opts?: {
  includeInactive?: boolean;
}): Promise<Application[]> {
  const db = await getDb();
  let query = db
    .from("applications")
    .select("*")
    .order("name", { ascending: true });
  if (!opts?.includeInactive) {
    query = query.eq("status", "ACTIVE");
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Application[];
}

export async function getApplication(id: string): Promise<Application | null> {
  const db = await getDb();
  const { data, error } = await db
    .from("applications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Application | null;
}

export async function createApplication(input: {
  name: string;
  description: string;
  model_type: ApplicationModelType;
}): Promise<Application> {
  const db = await getDb();
  const { data, error } = await db
    .from("applications")
    .insert({
      name: input.name.trim(),
      description: input.description.trim(),
      model_type: input.model_type,
      status: "ACTIVE",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/applications");
  return data as Application;
}

export async function updateApplication(
  id: string,
  input: {
    name: string;
    description: string;
    status: EntityStatus;
    model_type: ApplicationModelType;
  }
): Promise<Application> {
  const db = await getDb();
  const { data, error } = await db
    .from("applications")
    .update({
      name: input.name.trim(),
      description: input.description.trim(),
      status: input.status,
      model_type: input.model_type,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
  return data as Application;
}

export async function setApplicationStatus(
  id: string,
  status: EntityStatus
): Promise<void> {
  const db = await getDb();
  const { error } = await db
    .from("applications")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
}
