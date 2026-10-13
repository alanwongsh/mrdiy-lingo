"use server";

import { revalidatePath } from "next/cache";
import { requireAppCapability, requireSuperadmin } from "@/lib/auth/access";
import {
  ACCESS_ROLE_MIGRATION,
  isMissingAccessRoles,
  loadAccessRoles,
} from "@/lib/auth/access-roles";
import {
  PERMISSION_KEYS,
  canGrantRole,
  parsePermissions,
  type PermissionKey,
} from "@/lib/auth/permissions";
import { getDb } from "@/lib/db/client";
import type { AccessRole } from "@/lib/types";

/**
 * applicationId null means the default roles, which only a superadmin maintains.
 * Otherwise the roles of that application, for someone with roles.manage there.
 */
type Scope = { applicationId: string | null };

type Actor = { permissions: readonly PermissionKey[] };

async function authorize(scope: Scope): Promise<{ actor: Actor; roles: AccessRole[] }> {
  let actor: Actor;
  if (scope.applicationId) {
    const { access } = await requireAppCapability(scope.applicationId, "roles.manage");
    actor = access;
  } else {
    await requireSuperadmin();
    actor = { permissions: PERMISSION_KEYS };
  }
  const roles = await loadAccessRoles(scope.applicationId);
  if (!roles) throw new Error(ACCESS_ROLE_MIGRATION);
  return { actor, roles };
}

/** A role in this scope that the actor is allowed to change. */
function changeableRole(roles: AccessRole[], id: string, actor: Actor): AccessRole {
  const role = roles.find((item) => item.id === id);
  if (!role) throw new Error("That role was not found.");
  if (!canGrantRole(actor, role)) {
    throw new Error(`“${role.name}” has permissions you do not hold, so you cannot change it.`);
  }
  return role;
}

function revalidateRoles(scope: Scope) {
  if (scope.applicationId) revalidatePath(`/applications/${scope.applicationId}`, "layout");
  else revalidatePath("/roles");
}

function cleanDetails(input: { name: string; description: string }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) throw new Error("Enter a role name of up to 60 characters.");
  return { name, description: input.description.trim().slice(0, 200) };
}

function throwRoleError(error: { message: string; code?: string }): never {
  if (isMissingAccessRoles(error)) throw new Error(ACCESS_ROLE_MIGRATION);
  if (error.code === "23505") throw new Error("A role with that name already exists here.");
  if (error.code === "23503") {
    throw new Error("People still hold this role. Give them another role first.");
  }
  throw new Error(error.message);
}

export async function listAccessRoles(scope: Scope): Promise<{
  roles: AccessRole[];
  memberCounts: Record<string, number>;
} | null> {
  if (scope.applicationId) await requireAppCapability(scope.applicationId, "roles.manage");
  else await requireSuperadmin();
  const roles = await loadAccessRoles(scope.applicationId);
  if (!roles) return null;
  const memberCounts: Record<string, number> = {};
  if (roles.length > 0) {
    const db = await getDb();
    const { data, error } = await db
      .from("application_members")
      .select("access_role_id")
      .in(
        "access_role_id",
        roles.map((role) => role.id)
      );
    if (error) throwRoleError(error);
    for (const row of data ?? []) {
      const id = row.access_role_id as string;
      memberCounts[id] = (memberCounts[id] ?? 0) + 1;
    }
  }
  return { roles, memberCounts };
}

/** Replace the permissions of one role and keep the older membership columns in step. */
async function writePermissions(roleId: string, permissions: readonly PermissionKey[]): Promise<void> {
  const db = await getDb();
  const { error: clearError } = await db
    .from("access_role_permissions")
    .delete()
    .eq("role_id", roleId);
  if (clearError) throwRoleError(clearError);
  if (permissions.length > 0) {
    const { error } = await db
      .from("access_role_permissions")
      .insert(permissions.map((permission) => ({ role_id: roleId, permission })));
    if (error) throwRoleError(error);
  }
  const approves = permissions.includes("content.approve");
  const { error: memberError } = await db
    .from("application_members")
    .update({
      role: approves ? "HOD" : "EDITOR",
      can_edit: permissions.includes("content.edit"),
      can_approve: approves,
    })
    .eq("access_role_id", roleId);
  if (memberError) throwRoleError(memberError);
}

export async function createAccessRole(
  input: Scope & {
    name: string;
    description: string;
    /** Start from another role's permissions here. Leave out to start with none. */
    copyFromId?: string;
  }
): Promise<void> {
  const { actor, roles } = await authorize(input);
  const details = cleanDetails(input);
  const source = input.copyFromId ? changeableRole(roles, input.copyFromId, actor) : null;
  const db = await getDb();
  const { data, error } = await db
    .from("access_roles")
    .insert({ ...details, application_id: input.applicationId })
    .select("id")
    .single();
  if (error) throwRoleError(error);
  if (source) await writePermissions(data.id as string, source.permissions);
  revalidateRoles(input);
}

export async function updateAccessRoleDetails(
  input: Scope & { id: string; name: string; description: string }
): Promise<void> {
  const { actor, roles } = await authorize(input);
  const role = changeableRole(roles, input.id, actor);
  const db = await getDb();
  const { error } = await db
    .from("access_roles")
    .update(cleanDetails(input))
    .eq("id", role.id);
  if (error) throwRoleError(error);
  revalidateRoles(input);
}

/** Save the whole permission map at once: role id to the permissions it holds. */
export async function saveRolePermissions(
  input: Scope & { map: Record<string, string[]> }
): Promise<void> {
  const { actor, roles } = await authorize(input);
  const changes: Array<{ role: AccessRole; next: PermissionKey[] }> = [];
  for (const role of roles) {
    if (!(role.id in input.map)) continue;
    const next = parsePermissions(input.map[role.id]);
    const same =
      next.length === role.permissions.length &&
      next.every((key) => role.permissions.includes(key));
    if (same) continue;
    changeableRole(roles, role.id, actor);
    if (!canGrantRole(actor, { permissions: next })) {
      throw new Error(`You can only tick permissions you hold yourself (“${role.name}”).`);
    }
    changes.push({ role, next });
  }
  for (const change of changes) await writePermissions(change.role.id, change.next);
  revalidateRoles(input);
}

export async function deleteAccessRole(input: Scope & { id: string }): Promise<void> {
  const { actor, roles } = await authorize(input);
  const role = changeableRole(roles, input.id, actor);
  const db = await getDb();
  const { error } = await db.from("access_roles").delete().eq("id", role.id);
  if (error) throwRoleError(error);
  revalidateRoles(input);
}
