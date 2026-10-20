import { UserFacingError } from "@/lib/errors";
import { cache } from "react";
import type { HubActor } from "@/lib/auth/actor";
import { getActor } from "@/lib/auth/actor";
import { getDb } from "@/lib/db/client";
import { isMissingAccessRoles, loadAccessRoles } from "@/lib/auth/access-roles";
import { canSeeMarket, loadMemberUnits } from "@/lib/auth/business-units";
import { MARKETS, marketName, normalizeMarket } from "@/lib/markets";
import { bandForLdapRole, loadOrgRoleMap } from "@/lib/auth/org-roles";
import {
  capabilitiesForRole,
  ORG_BAND_LABEL,
  parseAppRole,
  roleFromApprovalFlag,
  type AppRole,
} from "@/lib/auth/roles";
import {
  APPROVER_PERMISSIONS,
  EDITOR_PERMISSIONS,
  PERMISSION_KEYS,
  type PermissionKey,
} from "@/lib/auth/permissions";
import type { AppAccess, HubUser } from "@/lib/types";

/** "edit", "approve", and "manage" are shorthands for content.edit, content.approve, and people.manage. */
export type AppCapability = "view" | "edit" | "approve" | "manage" | PermissionKey;

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
  // Email first: people are invited by email, and Joget or SSO always sends it.
  const lookups: Array<["username" | "employee_id" | "email", string]> = [];
  if (identity.email) lookups.push(["email", identity.email]);
  if (identity.username) lookups.push(["username", identity.username]);
  if (identity.employeeId) lookups.push(["employee_id", identity.employeeId]);

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

/** Add a job title sent by Joget to the list on the Job titles page. It grants nothing. */
async function rememberJobTitle(title: string): Promise<void> {
  const db = await getDb();
  const { data, error } = await db
    .from("org_role_map")
    .select("id")
    .ilike("ldap_role", literalIlike(title))
    .maybeSingle();
  if (error || data) return;
  // A lost race or a missing table only means the title is not listed yet.
  await db.from("org_role_map").insert({ ldap_role: title, band: "EDITOR" });
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
  const title = blankToNull(actor.title);
  if (title && title !== existing?.ldap_role) await rememberJobTitle(title);

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
        ...(title ? { ldap_role: title } : {}),
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
      ldap_role: title,
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
    storedEmail ||
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
  if (!user) throw new UserFacingError(SIGN_IN_MESSAGE);
  return user;
}

export async function requireSuperadmin(): Promise<HubUser> {
  const user = await requireUser();
  if (!user.is_superadmin) {
    throw new UserFacingError("This is limited to a Lingo superadmin.");
  }
  return user;
}

export function capabilityForReleaseStatus(status: string): AppCapability {
  if (status === "APPROVED" || status === "PUBLISHING" || status === "PUBLISHED") return "approve";
  return "edit";
}

const CAPABILITY_ALIAS: Record<"edit" | "approve" | "manage", PermissionKey> = {
  edit: "content.edit",
  approve: "content.approve",
  manage: "people.manage",
};

export function hasPermission(
  access: Pick<AppAccess, "permissions">,
  capability: AppCapability
): boolean {
  if (capability === "view") return true;
  const key =
    capability === "edit" || capability === "approve" || capability === "manage"
      ? CAPABILITY_ALIAS[capability]
      : capability;
  return access.permissions.includes(key);
}

export function accessFromPermissions(
  role: string | null,
  permissions: readonly PermissionKey[],
  isOwner = false,
  markets: string[] | null = null,
  unitNames: string[] = []
): AppAccess {
  return {
    is_owner: isOwner,
    markets,
    unit_names: unitNames,
    role,
    permissions: [...permissions],
    can_edit: permissions.includes("content.edit"),
    can_approve: permissions.includes("content.approve"),
    can_manage: permissions.includes("people.manage"),
  };
}

/** Permissions from the job title group, used before migration 026. */
export function legacyPermissions(canEdit: boolean, canApprove: boolean): readonly PermissionKey[] {
  if (canApprove) return APPROVER_PERMISSIONS;
  return canEdit ? EDITOR_PERMISSIONS : [];
}

export async function resolveAppAccess(
  user: HubUser,
  application: { id: string; owner_user_id: string | null }
): Promise<AppAccess | null> {
  if (user.is_superadmin || application.owner_user_id === user.id) {
    return accessFromPermissions(
      null,
      PERMISSION_KEYS,
      application.owner_user_id === user.id
    );
  }

  const membership = await loadMembership(application.id, user.id);
  if (!membership) return null;
  if (membership.access_role_id) {
    const assigned = (await loadAccessRoles(application.id))?.find(
      (role) => role.id === membership.access_role_id
    );
    if (assigned) {
      const units = membership.id
        ? await loadMemberUnits(membership.id)
        : { markets: null, names: [] };
      return accessFromPermissions(
        assigned.name,
        assigned.permissions,
        false,
        units.markets,
        units.names
      );
    }
  }

  // Before migration 026: the job title group decides.
  const map = await loadOrgRoleMap();
  const role = map ? bandForLdapRole(user.ldap_role, map) : membership.role;
  const caps = capabilitiesForRole(role === "ADMIN" ? "HOD" : role);
  return accessFromPermissions(
    ORG_BAND_LABEL[role === "EDITOR" ? "EDITOR" : "HOD"],
    legacyPermissions(
      map ? caps.can_edit : membership.can_edit,
      map ? caps.can_approve : membership.can_approve
    )
  );
}

async function loadMembership(
  applicationId: string,
  userId: string
): Promise<{
  id: string | null;
  role: AppRole;
  can_edit: boolean;
  can_approve: boolean;
  access_role_id: string | null;
} | null> {
  const db = await getDb();
  const withAccessRole = await db
    .from("application_members")
    .select("id, role, can_edit, can_approve, access_role_id")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!withAccessRole.error) {
    if (!withAccessRole.data) return null;
    const role =
      parseAppRole(withAccessRole.data.role) ??
      roleFromApprovalFlag(!!withAccessRole.data.can_approve);
    const caps = capabilitiesForRole(role);
    return {
      id: (withAccessRole.data.id as string | null) ?? null,
      role,
      can_edit: caps.can_edit,
      can_approve: caps.can_approve,
      access_role_id: (withAccessRole.data.access_role_id as string | null) ?? null,
    };
  }
  if (
    !isMissingAccessRoles(withAccessRole.error) &&
    !isMissingRoleColumn(withAccessRole.error)
  ) {
    throwDb(withAccessRole.error);
  }

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
      id: null,
      role: roleFromApprovalFlag(canApprove),
      can_edit: !!legacy.data.can_edit,
      can_approve: canApprove,
      access_role_id: null,
    };
  }
  if (withRole.error) throwDb(withRole.error);
  if (!withRole.data) return null;
  const role =
    parseAppRole(withRole.data.role) ??
    roleFromApprovalFlag(!!withRole.data.can_approve);
  const caps = capabilitiesForRole(role);
  return {
    id: null,
    role,
    can_edit: caps.can_edit,
    can_approve: caps.can_approve,
    access_role_id: null,
  };
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
  if (!application) throw new UserFacingError("Application not found.");
  const access = await resolveAppAccess(user, application);
  if (!access) throw new UserFacingError(
      "You no longer have access to this application. Reload the page, or ask the owner to add you again."
    );
  if (!hasPermission(access, capability)) {
    throw new UserFacingError(
      "Your role in this application does not allow this. If your access just changed, reload the page."
    );
  }
  return { user, applicationId: application.id, access };
}

/** The signed-in person's access to an application, or null when they have none. */
export async function currentAppAccess(applicationId: string): Promise<AppAccess | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const application = await loadApplication(applicationId);
  if (!application) return null;
  return resolveAppAccess(user, application);
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
  return hasPermission(access, capability);
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
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select("application_id, market")
    .eq("id", contentId)
    .maybeSingle();
  if (error) throwDb(error);
  if (!data?.application_id) throw new UserFacingError("Article not found.");
  const grant = await requireAppCapability(data.application_id as string, capability);
  requireMarketAccess(grant.access, data.market as string | null);
  return grant;
}

/** A market picked for an article: required, from the market list, and in the person's units. */
export function requireChosenMarket(access: AppAccess, market: string | null | undefined): string {
  const code = normalizeMarket(market);
  if (!code) throw new UserFacingError("Choose a market for this article.");
  if (!MARKETS.some((item) => item.code === code)) {
    throw new UserFacingError(`“${code}” is not a market this app knows.`);
  }
  if (!canSeeMarket(access, code)) {
    throw new UserFacingError(
      `${marketName(code)} is outside your business unit. Choose one of your markets.`
    );
  }
  return code;
}

/** Throws unless the person's business units cover this market. */
export function requireMarketAccess(access: AppAccess, market: string | null | undefined) {
  if (canSeeMarket(access, market)) return;
  throw new UserFacingError(
    access.markets?.length
      ? "This article belongs to a country outside your business unit."
      : "You are not in a business unit yet, so you cannot see articles. Ask the application owner to add you to one."
  );
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
  if (!data?.content_id) throw new UserFacingError("Translation not found.");
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
  if (!data?.content_translation_id) throw new UserFacingError("Version not found.");
  return requireContentTranslationAccess(
    data.content_translation_id as string,
    capability
  );
}

export async function requireItemAccess(
  itemId: string,
  capability: AppCapability
): Promise<AccessGrant> {
  const applicationId = await applicationIdFrom("catalog_items", itemId, "Item not found.");
  return requireAppCapability(applicationId, capability);
}

export async function requireItemValueAccess(
  valueId: string,
  capability: AppCapability
): Promise<AccessGrant & { itemId: string }> {
  const db = await getDb();
  const { data, error } = await db
    .from("catalog_values")
    .select("item_id")
    .eq("id", valueId)
    .maybeSingle();
  if (error) throwDb(error);
  if (!data?.item_id) throw new UserFacingError("Value not found.");
  const grant = await requireItemAccess(data.item_id as string, capability);
  return { ...grant, itemId: data.item_id as string };
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
  if (!data?.translation_key_id) throw new UserFacingError("Translation not found.");
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
  if (!data?.translation_id) throw new UserFacingError("Version not found.");
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
    throw new UserFacingError("Enter an email or employee ID.");
  }
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UserFacingError("Enter a valid email.");
    }
    return { email, employeeId: null, username: null, label: email };
  }
  if (value.length > 80) throw new UserFacingError("Employee ID is too long.");
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
