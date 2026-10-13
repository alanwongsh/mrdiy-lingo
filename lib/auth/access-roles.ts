import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { parsePermissions } from "@/lib/auth/permissions";
import type { AccessRole } from "@/lib/types";

export type { AccessRole };

export const ACCESS_ROLE_MIGRATION =
  "Run migrations 025_access_roles.sql, 026_access_role_permissions.sql, and 027_application_roles.sql from Setup.";

export function isMissingAccessRoles(error: { message: string; code?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST200" ||
    (error.code === "42703" && /access_role|application_id|copied_from/i.test(error.message))
  );
}

/**
 * Roles of one application, or the defaults copied into new applications when
 * applicationId is null. Null when the role migrations have not been run.
 */
export const loadAccessRoles = cache(
  async (applicationId: string | null): Promise<AccessRole[] | null> => {
    const db = await getDb();
    const base = db
      .from("access_roles")
      .select("id, name, description, application_id, grants:access_role_permissions(permission)");
    const scoped = applicationId
      ? base.eq("application_id", applicationId)
      : base.is("application_id", null);
    const { data, error } = await scoped.order("name", { ascending: true });
    if (error) {
      if (isMissingAccessRoles(error)) return null;
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? "",
      applicationId: (row.application_id as string | null) ?? null,
      permissions: parsePermissions(
        ((row.grants ?? []) as Array<{ permission: string }>).map((grant) => grant.permission)
      ),
    }));
  }
);

/** Copy the default roles and their permissions into a new application. */
export async function copyDefaultRoles(applicationId: string): Promise<void> {
  const defaults = await loadAccessRoles(null);
  if (!defaults || defaults.length === 0) return;
  const db = await getDb();
  for (const role of defaults) {
    const { data, error } = await db
      .from("access_roles")
      .insert({
        name: role.name,
        description: role.description,
        application_id: applicationId,
        copied_from: role.id,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") continue;
      throw new Error(error.message);
    }
    if (role.permissions.length > 0) {
      const { error: grantError } = await db
        .from("access_role_permissions")
        .insert(role.permissions.map((permission) => ({ role_id: data.id, permission })));
      if (grantError) throw new Error(grantError.message);
    }
  }
}
