"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth/access";
import { loadOrgRoleMap, normalizeLdapRole } from "@/lib/auth/org-roles";
import { parseOrgBand, type OrgRoleBand } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import type { OrgRoleMapping } from "@/lib/types";

const MIGRATION = "Run migration 012_org_role_map.sql from Setup.";

function revalidateRoles() {
  revalidatePath("/", "layout");
}

export async function listOrgRoleMappings(): Promise<OrgRoleMapping[]> {
  await requireSuperadmin();
  const rows = await loadOrgRoleMap();
  if (!rows) throw new Error(MIGRATION);
  return rows;
}

export async function addOrgRoleMapping(input: {
  ldapRole: string;
  band: OrgRoleBand;
}): Promise<void> {
  await requireSuperadmin();
  const ldapRole = normalizeLdapRole(input.ldapRole);
  const band = parseOrgBand(input.band);
  if (!ldapRole || ldapRole.length > 80) {
    throw new Error("Enter the role stored on the account.");
  }
  if (!band) throw new Error("Choose a group.");
  const db = await getDb();
  const existing = await db
    .from("org_role_map")
    .select("id")
    .ilike("ldap_role", ldapRole.replace(/[%_\\]/g, (match) => `\\${match}`))
    .maybeSingle();
  if (existing.error) {
    if (existing.error.code === "42P01") throw new Error(MIGRATION);
    throw new Error(existing.error.message);
  }
  if (existing.data) throw new Error("That role is already in the map.");
  const { error } = await db.from("org_role_map").insert({
    ldap_role: ldapRole,
    band,
  });
  if (error) {
    if (error.code === "42P01") throw new Error(MIGRATION);
    if (error.code === "23505") throw new Error("That role is already in the map.");
    throw new Error(error.message);
  }
  revalidateRoles();
}

export async function setOrgRoleBand(input: {
  id: string;
  band: OrgRoleBand;
}): Promise<void> {
  await requireSuperadmin();
  const band = parseOrgBand(input.band);
  if (!band) throw new Error("Choose a group.");
  const db = await getDb();
  const { error } = await db
    .from("org_role_map")
    .update({ band })
    .eq("id", input.id);
  if (error) {
    if (error.code === "42P01") throw new Error(MIGRATION);
    throw new Error(error.message);
  }
  revalidateRoles();
}

export async function removeOrgRoleMapping(input: { id: string }): Promise<void> {
  await requireSuperadmin();
  const db = await getDb();
  const { error } = await db.from("org_role_map").delete().eq("id", input.id);
  if (error) {
    if (error.code === "42P01") throw new Error(MIGRATION);
    throw new Error(error.message);
  }
  revalidateRoles();
}
