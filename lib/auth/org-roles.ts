import { cache } from "react";
import { getDb } from "@/lib/db/client";
import {
  parseOrgBand,
  type AppRole,
} from "@/lib/auth/roles";
import type { OrgRoleMapping } from "@/lib/types";

export type { OrgRoleMapping };

export function normalizeLdapRole(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function bandForLdapRole(
  ldapRole: string | null | undefined,
  rows: OrgRoleMapping[]
): AppRole {
  const key = normalizeLdapRole(ldapRole ?? "").toLowerCase();
  if (!key) return "EDITOR";
  const hit = rows.find(
    (row) => normalizeLdapRole(row.ldap_role).toLowerCase() === key
  );
  return hit?.band === "HOD" ? "HOD" : "EDITOR";
}

function isMissingMap(error: { message: string; code?: string }): boolean {
  return (
    error.code === "42P01" ||
    (error.code === "42703" && /ldap_role|org_role_map|\bband\b/i.test(error.message))
  );
}

export const loadOrgRoleMap = cache(async (): Promise<OrgRoleMapping[] | null> => {
  const db = await getDb();
  const { data, error } = await db
    .from("org_role_map")
    .select("id, ldap_role, band")
    .order("ldap_role", { ascending: true });
  if (error) {
    if (isMissingMap(error)) return null;
    throw new Error(error.message);
  }
  return (data ?? []).flatMap((row) => {
    const band = parseOrgBand(row.band);
    const ldapRole = typeof row.ldap_role === "string" ? row.ldap_role.trim() : "";
    if (!band || !ldapRole) return [];
    return [{ id: row.id as string, ldap_role: ldapRole, band }];
  });
});
