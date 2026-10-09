import { cache } from "react";
import type { HubActor } from "@/lib/auth/actor";
import { getActor } from "@/lib/auth/actor";
import { getDb } from "@/lib/db/client";
import { bandForLdapRole, loadOrgRoleMap } from "@/lib/auth/org-roles";
import {
  capabilitiesForRole,
  parseAppRole,
  roleFromApprovalFlag,
  type AppRole,
} from "@/lib/auth/roles";
import type { AppAccess, HubUser } from "@/lib/types";

export type AppCapability = "view" | "edit" | "approve" | "manage";

export type AccessGrant = {
  user: HubUser;
  applicationId: string;
  access: AppAccess;
};

const SIGN_IN_MESSAGE = "Sign in to continue.";
const SCHEMA_MESSAGE = "Run migration 008_access_control.sql from Setup.";
const ROLE_SCHEMA_MESSAGE = "Run migration 011_member_roles.sql from Setup.";

type Identity = {
  username?: string | null;
  email?: string | null;
  employeeId?: string | null;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function superadminKeys(): Set<string> {
  return new Set(
    (process.env.LINGO_SUPERADMINS ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
}

function listedAsSuperadmin(keys: Set<string>, identity: Identity): boolean {
  if (keys.size === 0) return false;
  return [identity.username, identity.email, identity.employeeId].some(
    (value) => !!value && keys.has(value.trim().toLowerCase())
  );
}

function asUser(row: HubUser): HubUser {
  return {
    id: row.id,
    username: row.username,
    employee_id: row.employee_id,
    email: row.email,
    display_name: row.display_name,
    is_superadmin: !!row.is_superadmin,
    ldap_role: row.ldap_role ?? null,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isMissingRoleColumn(error: { message: string; code?: string }): boolean {
  return error.code === "42703" && /\brole\b/i.test(error.message);
}

export function accessErrorMessage(error: {
  message: string;
  code?: string;
}): string {
  if (isMissingRoleColumn(error)) return ROLE_SCHEMA_MESSAGE;
  const missing =
    error.code === "42P01" ||
    error.code === "42703" ||
    /hub_users|application_members|owner_user_id/i.test(error.message);
  return missing ? SCHEMA_MESSAGE : error.message;
}

function throwDb(error: { message: string; code?: string }): never {
  throw new Error(accessErrorMessage(error));
}

function literalIlike(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`);
}

async function findDirectoryUser(identity: Identity): Promise<HubUser | null> {
  const db = await getDb();
  const lookups: Array<["username" | "employee_id" | "email", string]> = [];
  if (identity.username) lookups.push(["username", identity.username]);
  if (identity.employeeId) lookups.push(["employee_id", identity.employeeId]);
  if (identity.email) lookups.push(["email", identity.email]);

  for (const [column, value] of lookups) {
    const { data, error } = await db
      .from("hub_users")
      .select("*")
      .ilike(column, literalIlike(value))
      .maybeSingle();
    if (error) throwDb(error);
    if (data) return asUser(data as HubUser);
  }
  return null;
}

async function upsertFromActor(actor: HubActor): Promise<HubUser> {
  const db = await getDb();
  const identity: Identity = {
    username: blankToNull(actor.username),
    email: blankToNull(actor.email)?.toLowerCase() ?? null,
    employeeId: blankToNull(actor.employeeId),
  };
  const keys = superadminKeys();
  const listed = listedAsSuperadmin(keys, identity);
  const existing = await findDirectoryUser(identity);
  const now = new Date().toISOString();

  if (existing) {
    const { data, error } = await db
      .from("hub_users")
      .update({
        username: identity.username ?? existing.username,
        employee_id: identity.employeeId ?? existing.employee_id,
        email: identity.email ?? existing.email,
        display_name: blankToNull(actor.name) ?? existing.display_name,
        is_superadmin: keys.size > 0 ? listed : existing.is_superadmin,
        last_seen_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throwDb(error);
    return asUser(data as HubUser);
  }

  const { data, error } = await db
    .from("hub_users")
    .insert({
      username: identity.username,
      employee_id: identity.employeeId,
      email: identity.email,
      display_name: blankToNull(actor.name) ?? identity.username ?? "User",
      is_superadmin: listed,
      last_seen_at: now,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      const raced = await findDirectoryUser(identity);
      if (raced) return raced;
    }
    throwDb(error);
  }
  return asUser(data as HubUser);
}

export const getCurrentUser = cache(async (): Promise<HubUser | null> => {
  const actor = await getActor();
  if (!actor) return null;
  return upsertFromActor(actor);
});

/** Sign-in identity for an account that already exists. Does not create a user. */
export async function actorForStoredEmail(email: string): Promise<HubActor | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 160 || !normalized.includes("@")) return null;
  const db = await getDb();
  const { data, error } = await db
    .from("hub_users")
    .select("username, employee_id, email, display_name")
    .ilike("email", literalIlike(normalized))
    .maybeSingle();
  if (error) throwDb(error);
  if (!data) return null;
  const storedEmail = data.email?.trim() || normalized;
  const username = (
    data.username?.trim() ||
    data.employee_id?.trim() ||
    storedEmail.split("@")[0] ||
    ""
  ).slice(0, 80);
  const name = (data.display_name?.trim() || username).slice(0, 120);
  if (!username || !name) return null;
  return {
    username,
    name,
    email: storedEmail,
    employeeId: data.employee_id?.trim() || null,
  };
}

export async function requireUser(): Promise<HubUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error(SIGN_IN_MESSAGE);
  return user;
}

export async function requireSuperadmin(): Promise<HubUser> {
  const user = await requireUser();
  if (!user.is_superadmin) {
    throw new Error("This is limited to a Lingo superadmin.");
  }
  return user;
}

export function capabilityForReleaseStatus(status: string): AppCapability {
  if (status === "APPROVED" || status === "PUBLISHING" || status === "PUBLISHED") return "approve";
  return "edit";
}

function allows(access: AppAccess, capability: AppCapability): boolean {
  if (capability === "view") return true;
  if (capability === "edit") return access.can_edit;
  if (capability === "approve") return access.can_approve;
  return access.can_manage;
}

export async function resolveAppAccess(
  user: HubUser,
  application: { id: string; owner_user_id: string | null }
): Promise<AppAccess | null> {
  if (user.is_superadmin || application.owner_user_id === user.id) {
    return {
      is_owner: application.owner_user_id === user.id,
      role: null,
      can_edit: true,
      can_approve: true,
      can_manage: true,
    };
  }

  const membership = await loadMembership(application.id, user.id);
  if (!membership) return null;
  const map = await loadOrgRoleMap();
  const role = map ? bandForLdapRole(user.ldap_role, map) : membership.role;
  const caps = capabilitiesForRole(role === "ADMIN" ? "HOD" : role);
  return {
    is_owner: false,
    role,
    can_edit: map ? caps.can_edit : membership.can_edit,
    can_approve: map ? caps.can_approve : membership.can_approve,
    can_manage: false,
  };
}

async function loadMembership(
  applicationId: string,
  userId: string
): Promise<{ role: AppRole; can_edit: boolean; can_approve: boolean } | null> {
  const db = await getDb();
  const withRole = await db
    .from("application_members")
    .select("role, can_edit, can_approve")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (withRole.error && isMissingRoleColumn(withRole.error)) {
    const legacy = await db
      .from("application_members")
      .select("can_edit, can_approve")
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (legacy.error) throwDb(legacy.error);
    if (!legacy.data) return null;
    const canApprove = !!legacy.data.can_approve;
    return {
      role: roleFromApprovalFlag(canApprove),
      can_edit: !!legacy.data.can_edit,
      can_approve: canApprove,
    };
  }
  if (withRole.error) throwDb(withRole.error);
  if (!withRole.data) return null;
  const role =
    parseAppRole(withRole.data.role) ??
    roleFromApprovalFlag(!!withRole.data.can_approve);
  const caps = capabilitiesForRole(role);
  return { role, can_edit: caps.can_edit, can_approve: caps.can_approve };
}

async function loadApplication(applicationId: string): Promise<{
  id: string;
  owner_user_id: string | null;
} | null> {
  const db = await getDb();
  const { data, error } = await db
    .from("applications")
    .select("id, owner_user_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throwDb(error);
  return data;
}

export async function requireAppCapability(
  applicationId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const user = await requireUser();
  const application = await loadApplication(applicationId);
  if (!application) throw new Error("Application not found.");
  const access = await resolveAppAccess(user, application);
  if (!access) throw new Error("You do not have access to this application.");
  if (!allows(access, capability)) {
    throw new Error("You do not have permission to do that.");
  }
  return { user, applicationId: application.id, access };
}

export async function allowAppCapability(
  applicationId: string,
  capability: AppCapability
): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const application = await loadApplication(applicationId);
  if (!application) return false;
  const access = await resolveAppAccess(user, application);
  if (!access) return false;
  return allows(access, capability);
}

async function applicationIdFrom(
  table: string,
  id: string,
  missing: string
): Promise<string> {
  const db = await getDb();
  const { data, error } = await db
    .from(table)
    .select("application_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throwDb(error);
  if (!data?.application_id) throw new Error(missing);
  return data.application_id as string;
}

export async function requireContentAccess(
  contentId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const applicationId = await applicationIdFrom("content", contentId, "Article not found.");
  return requireAppCapability(applicationId, capability);
}

export async function requireContentTranslationAccess(
  contentTranslationId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const db = await getDb();
  const { data, error } = await db
    .from("content_translations")
    .select("content_id")
    .eq("id", contentTranslationId)
    .maybeSingle();
  if (error) throwDb(error);
  if (!data?.content_id) throw new Error("Translation not found.");
  return requireContentAccess(data.content_id as string, capability);
}

export async function requireContentVersionAccess(
  versionId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const db = await getDb();
  const { data, error } = await db
    .from("content_translation_versions")
    .select("content_translation_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throwDb(error);
  if (!data?.content_translation_id) throw new Error("Version not found.");
  return requireContentTranslationAccess(
    data.content_translation_id as string,
    capability
  );
}

export async function requireTranslationKeyAccess(
  translationKeyId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const applicationId = await applicationIdFrom(
    "translation_keys",
    translationKeyId,
    "Translation key not found."
  );
  return requireAppCapability(applicationId, capability);
}

export async function requireNamespaceAccess(
  namespaceId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const applicationId = await applicationIdFrom(
    "namespaces",
    namespaceId,
    "Namespace not found."
  );
  return requireAppCapability(applicationId, capability);
}

export async function requireTranslationAccess(
  translationId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const db = await getDb();
  const { data, error } = await db
    .from("translations")
    .select("translation_key_id")
    .eq("id", translationId)
    .maybeSingle();
  if (error) throwDb(error);
  if (!data?.translation_key_id) throw new Error("Translation not found.");
  return requireTranslationKeyAccess(data.translation_key_id as string, capability);
}

export async function requireTranslationVersionAccess(
  versionId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const db = await getDb();
  const { data, error } = await db
    .from("translation_versions")
    .select("translation_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throwDb(error);
  if (!data?.translation_id) throw new Error("Version not found.");
  return requireTranslationAccess(data.translation_id as string, capability);
}

export function classifyIdentity(raw: string): {
  email: string | null;
  employeeId: string | null;
  username: string | null;
  label: string;
} {
  const value = raw.trim();
  if (!value || value.length > 160) {
    throw new Error("Enter an email or employee ID.");
  }
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email.");
    }
    return { email, employeeId: null, username: null, label: email };
  }
  if (value.length > 80) throw new Error("Employee ID is too long.");
  return { email: null, employeeId: value, username: value, label: value };
}

export async function ensureDirectoryUser(identityText: string): Promise<HubUser> {
  const identity = classifyIdentity(identityText);
  const existing = await findDirectoryUser(identity);
  if (existing) return existing;

  const db = await getDb();
  const { data, error } = await db
    .from("hub_users")
    .insert({
      username: identity.username,
      employee_id: identity.employeeId,
      email: identity.email,
      display_name: identity.label,
      is_superadmin: false,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      const raced = await findDirectoryUser(identity);
      if (raced) return raced;
    }
    throwDb(error);
  }
  return asUser(data as HubUser);
}

export async function canOpenSetup(): Promise<boolean> {
  const db = await getDb();
  const { data, error } = await db
    .from("hub_users")
    .select("id")
    .eq("is_superadmin", true)
    .limit(1);
  if (error) return true;
  if (!data?.length) return true;
  const user = await getCurrentUser();
  return !!user?.is_superadmin;
}

export function personDetail(user: Pick<HubUser, "employee_id" | "email" | "username">): string {
  return user.employee_id || user.email || user.username || "";
}
