"use server";

import { revalidatePath } from "next/cache";
import {
  accessErrorMessage,
  ensureDirectoryUser,
  personDetail,
  requireAppCapability,
  requireSuperadmin,
  requireUser,
  resolveAppAccess,
} from "@/lib/auth/access";
import {
  copyDefaultRoles,
  isMissingAccessRoles,
  loadAccessRoles,
} from "@/lib/auth/access-roles";
import {
  bandForLdapRole,
  loadOrgRoleMap,
  normalizeLdapRole,
} from "@/lib/auth/org-roles";
import {
  capabilitiesForRole,
  parseAppRole,
  roleFromApprovalFlag,
} from "@/lib/auth/roles";
import { canGrantRole } from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/auth/password";
import { ensureDefaultContentType } from "@/lib/actions/content-types";
import { ensureCatalogFields } from "@/lib/actions/catalog";
import { catalogTemplate } from "@/lib/catalog";
import { getDb } from "@/lib/db/client";
import type {
  AppAccess,
  AccessRole,
  Application,
  ApplicationMemberView,
  ApplicationModelType,
  EntityStatus,
  HubUser,
  VisibleApplication,
} from "@/lib/types";

function revalidateApplication(id: string) {
  revalidatePath("/");
  revalidatePath("/applications");
  revalidatePath(`/applications/${id}`);
  revalidatePath(`/applications/${id}/settings/general`);
  revalidatePath(`/applications/${id}/settings/people`);
}

async function withAccess(
  user: HubUser,
  apps: Application[]
): Promise<VisibleApplication[]> {
  const visible: VisibleApplication[] = [];
  for (const app of apps) {
    const access = await resolveAppAccess(user, app);
    if (access) visible.push({ ...app, access });
  }
  return visible;
}

export async function listApplications(opts?: {
  includeInactive?: boolean;
  editableOnly?: boolean;
}): Promise<VisibleApplication[]> {
  const user = await requireUser();
  const db = await getDb();
  let query = db
    .from("applications")
    .select("*")
    .order("name", { ascending: true });
  if (!opts?.includeInactive) {
    query = query.eq("status", "ACTIVE");
  }
  if (!user.is_superadmin) {
    const { data: memberships, error: memberError } = await db
      .from("application_members")
      .select("application_id")
      .eq("user_id", user.id);
    if (memberError) throw new Error(memberError.message);
    const memberIds = (memberships ?? []).map((row) => row.application_id as string);
    if (memberIds.length === 0) {
      query = query.eq("owner_user_id", user.id);
    } else {
      query = query.or(
        `owner_user_id.eq.${user.id},id.in.(${memberIds.join(",")})`
      );
    }
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const visible = await withAccess(user, (data ?? []) as Application[]);
  if (!opts?.editableOnly) return visible;
  return visible.filter((app) => app.access.can_edit);
}

export async function getApplication(
  id: string
): Promise<VisibleApplication | null> {
  const user = await requireUser();
  const db = await getDb();
  const { data, error } = await db
    .from("applications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const app = data as Application;
  const access = await resolveAppAccess(user, app);
  if (!access) return null;
  return { ...app, access };
}

export async function createApplication(input: {
  name: string;
  description: string;
  model_type: ApplicationModelType;
  /** CATALOG only. */
  item_label?: string;
  /** CATALOG only: starter fields, such as sku. */
  template?: string;
}): Promise<Application> {
  const user = await requireSuperadmin();
  const db = await getDb();
  const isCatalog = input.model_type === "CATALOG";
  const { data, error } = await db
    .from("applications")
    .insert({
      name: input.name.trim(),
      description: input.description.trim(),
      model_type: input.model_type,
      status: "ACTIVE",
      owner_user_id: user.id,
      ...(isCatalog
        ? { item_label: input.item_label?.trim().slice(0, 40) || catalogTemplate(input.template).itemLabel }
        : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const application = data as Application;
  if (application.model_type === "CONTENT") {
    await ensureDefaultContentType(application.id);
  }
  if (application.model_type === "CATALOG") {
    await ensureCatalogFields(application.id, input.template);
  }
  await copyDefaultRoles(application.id);
  revalidatePath("/");
  revalidatePath("/applications");
  return application;
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
  await requireAppCapability(id, "settings.general");
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
  const application = data as Application;
  if (application.model_type === "CONTENT") {
    await ensureDefaultContentType(application.id);
  }
  if (application.model_type === "CATALOG") {
    await ensureCatalogFields(application.id);
  }
  revalidateApplication(id);
  return application;
}

export async function setApplicationStatus(
  id: string,
  status: EntityStatus
): Promise<void> {
  await requireAppCapability(id, "settings.general");
  const db = await getDb();
  const { error } = await db
    .from("applications")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateApplication(id);
}

export async function setReviewEmailNotifications(
  id: string,
  enabled: boolean
): Promise<void> {
  await requireAppCapability(id, "settings.notifications");
  const db = await getDb();
  const { error } = await db
    .from("applications")
    .update({ notify_review_email: enabled })
    .eq("id", id);
  if (error) {
    if (error.code === "42703") {
      throw new Error("Run migration 020_review_email_setting.sql first.");
    }
    throw new Error(error.message);
  }
  revalidatePath(`/applications/${id}/settings/general`);
}

/** Whether the account has signed in yet, and whether it has a sign-in password. */
function accountState(row: unknown): { signedIn: boolean; hasPassword: boolean } {
  const account = (row ?? {}) as { last_seen_at?: string | null; password_hash?: string | null };
  return { signedIn: !!account.last_seen_at, hasPassword: !!account.password_hash };
}

export async function listApplicationPeople(applicationId: string): Promise<{
  owner: ApplicationMemberView | null;
  members: ApplicationMemberView[];
  orgRoles: Awaited<ReturnType<typeof loadOrgRoleMap>>;
  accessRoles: AccessRole[] | null;
}> {
  await requireAppCapability(applicationId, "manage");
  const db = await getDb();
  const { data: app, error: appError } = await db
    .from("applications")
    .select("owner_user_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (appError) throw new Error(appError.message);
  if (!app) throw new Error("Application not found.");

  let owner: ApplicationMemberView | null = null;
  if (app.owner_user_id) {
    const { data: ownerRow, error: ownerError } = await db
      .from("hub_users")
      .select("*")
      .eq("id", app.owner_user_id)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    if (ownerRow) {
      const user = ownerRow as HubUser;
      owner = {
        membershipId: user.id,
        userId: user.id,
        displayName: user.display_name,
        detail: personDetail(user),
        ldapRole: user.ldap_role ?? null,
        ...accountState(ownerRow),
        accessRoleId: null,
        role: null,
        canEdit: true,
        canApprove: true,
        canManage: true,
      };
    }
  }

  const accessRoles = await loadAccessRoles(applicationId);
  type MemberRow = {
    id: string;
    role: string | null;
    can_edit: boolean;
    can_approve: boolean;
    access_role_id?: string | null;
    user: unknown;
  };
  let rows: MemberRow[] | null = null;
  let listed: { data: MemberRow[] | null; error: { message: string; code?: string } | null } =
    await db
      .from("application_members")
      .select("id, role, can_edit, can_approve, access_role_id, user:hub_users(*)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
  if (listed.error && isMissingAccessRoles(listed.error)) {
    listed = await db
      .from("application_members")
      .select("id, role, can_edit, can_approve, user:hub_users(*)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
  }
  rows = listed.data;
  if (listed.error) {
    const missingRole =
      listed.error.code === "42703" && /\brole\b/i.test(listed.error.message);
    if (!missingRole) throw new Error(accessErrorMessage(listed.error));
    const legacy = await db
      .from("application_members")
      .select("id, can_edit, can_approve, user:hub_users(*)")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
    if (legacy.error) throw new Error(accessErrorMessage(legacy.error));
    rows = (legacy.data ?? []).map((row) => ({ ...row, role: null }));
  }

  const orgRoles = await loadOrgRoleMap();
  const members = (rows ?? []).flatMap((row): ApplicationMemberView[] => {
    const user = (Array.isArray(row.user) ? row.user[0] : row.user) as HubUser | null;
    if (!user) return [];
    const base = {
      membershipId: row.id as string,
      userId: user.id,
      displayName: user.display_name,
      detail: personDetail(user),
      ldapRole: user.ldap_role ?? null,
      ...accountState(user),
    };
    const assigned = accessRoles?.find((role) => role.id === row.access_role_id);
    if (assigned) {
      return [
        {
          ...base,
          accessRoleId: assigned.id,
          role: assigned.name,
          canEdit: assigned.permissions.includes("content.edit"),
          canApprove: assigned.permissions.includes("content.approve"),
          canManage: assigned.permissions.includes("people.manage"),
        },
      ];
    }
    const stored =
      parseAppRole(row.role) ?? roleFromApprovalFlag(!!row.can_approve);
    const band = orgRoles ? bandForLdapRole(user.ldap_role, orgRoles) : stored;
    const caps = capabilitiesForRole(band === "ADMIN" ? "HOD" : band);
    return [
      {
        ...base,
        accessRoleId: null,
        role: null,
        canEdit: orgRoles ? caps.can_edit : !!row.can_edit,
        canApprove: orgRoles ? caps.can_approve : !!row.can_approve,
        canManage: false,
      },
    ];
  });

  return { owner, members, orgRoles, accessRoles };
}

function mappedTitle(
  ldapRole: string,
  orgRoles: NonNullable<Awaited<ReturnType<typeof loadOrgRoleMap>>>
): string | null {
  const key = normalizeLdapRole(ldapRole).toLowerCase();
  if (!key) return null;
  return (
    orgRoles.find(
      (row) => normalizeLdapRole(row.ldap_role).toLowerCase() === key
    )?.ldap_role ?? null
  );
}

async function writeAccountRole(
  userId: string,
  ldapRole: string | null,
  band: "EDITOR" | "HOD"
): Promise<string | undefined> {
  const caps = capabilitiesForRole(band);
  const db = await getDb();
  const { error: userError } = await db
    .from("hub_users")
    .update({ ldap_role: ldapRole })
    .eq("id", userId);
  if (userError) return accessErrorMessage(userError);
  const { error } = await db
    .from("application_members")
    .update({
      role: band,
      can_edit: caps.can_edit,
      can_approve: caps.can_approve,
    })
    .eq("user_id", userId);
  if (error) return accessErrorMessage(error);
}

async function assignLdapRole(userId: string, ldapRole: string): Promise<void> {
  const trimmed = ldapRole.trim();
  if (!trimmed) {
    const error = await writeAccountRole(userId, null, "EDITOR");
    if (error) throw new Error(error);
    return;
  }
  const orgRoles = await loadOrgRoleMap();
  if (!orgRoles) throw new Error("Run migration 012_org_role_map.sql from Setup.");
  const title = mappedTitle(trimmed, orgRoles);
  if (!title) throw new Error("Add that role on the Roles page before assigning it.");
  const band = bandForLdapRole(title, orgRoles);
  const error = await writeAccountRole(userId, title, band === "ADMIN" ? "HOD" : band);
  if (error) throw new Error(error);
}

const OWN_ROLE_MESSAGE = "Ask the owner or another manager to change your own role.";

/** Job title from the list on the Job titles page, or null for none. It grants nothing. */
async function resolveJobTitle(input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const orgRoles = await loadOrgRoleMap();
  if (!orgRoles) throw new Error("Run migration 012_org_role_map.sql from Setup.");
  const title = mappedTitle(trimmed, orgRoles);
  if (!title) throw new Error("Add that job title on the Job titles page before assigning it.");
  return title;
}

/** The chosen role, if the person giving it holds every permission in it. */
function assignableRole(roles: AccessRole[], id: string, actor: AppAccess): AccessRole {
  const role = roles.find((item) => item.id === id);
  if (!role) throw new Error("Choose a role.");
  if (!canGrantRole(actor, role)) {
    throw new Error("You can only give a role whose permissions you hold yourself.");
  }
  return role;
}

/** Someone whose role holds more than yours can only be changed by someone who holds it too. */
function assertCanChangeHolder(
  roles: AccessRole[],
  currentRoleId: string | null,
  actor: AppAccess
): void {
  const current = roles.find((item) => item.id === currentRoleId);
  if (current && !canGrantRole(actor, current)) {
    throw new Error("This person's role has permissions you do not hold, so you cannot change it.");
  }
}

/** Columns that give one membership a role. The older role columns follow it. */
function membershipRoleColumns(role: AccessRole) {
  const approves = role.permissions.includes("content.approve");
  return {
    access_role_id: role.id,
    role: approves ? "HOD" : "EDITOR",
    can_edit: role.permissions.includes("content.edit"),
    can_approve: approves,
  };
}

const ACCOUNT_LOCKED_MESSAGE =
  "This account has access outside this application. Ask a superadmin to change its sign-in.";

function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password must be 200 characters or fewer.";
  return null;
}

/**
 * An owner may only change the name or password of an account that exists for
 * this application alone. Otherwise they could take over someone else's sign-in.
 */
async function accountLockReason(
  actor: HubUser,
  userId: string,
  applicationId: string
): Promise<string | null> {
  if (actor.is_superadmin) return null;
  if (actor.id === userId) return ACCOUNT_LOCKED_MESSAGE;
  const db = await getDb();
  const { data: target, error } = await db
    .from("hub_users")
    .select("is_superadmin")
    .eq("id", userId)
    .maybeSingle();
  if (error) return accessErrorMessage(error);
  if (!target) return "That person was not found.";
  if (target.is_superadmin) return ACCOUNT_LOCKED_MESSAGE;

  const owned = await db
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId);
  if (owned.error) return accessErrorMessage(owned.error);
  if (owned.count) return ACCOUNT_LOCKED_MESSAGE;

  const elsewhere = await db
    .from("application_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("application_id", applicationId);
  if (elsewhere.error) return accessErrorMessage(elsewhere.error);
  if (elsewhere.count) return ACCOUNT_LOCKED_MESSAGE;
  return null;
}

async function writeSignIn(
  userId: string,
  fields: { displayName?: string; password?: string }
): Promise<string | null> {
  const update: Record<string, string> = {};
  const name = fields.displayName?.trim();
  if (name) update.display_name = name.slice(0, 120);
  if (fields.password) update.password_hash = await hashPassword(fields.password);
  if (Object.keys(update).length === 0) return null;
  const db = await getDb();
  const { error } = await db.from("hub_users").update(update).eq("id", userId);
  if (!error) return null;
  if (error.code === "42703" && /password_hash/i.test(error.message)) {
    return "Run migration 009_password_sign_in.sql from Setup.";
  }
  return accessErrorMessage(error);
}

export async function inviteApplicationMember(input: {
  applicationId: string;
  identity: string;
  ldapRole: string;
  accessRoleId?: string;
  displayName?: string;
  /** Optional. With one, they can also sign in on /sign-in without Joget. */
  password?: string;
}): Promise<{ error?: string }> {
  try {
    const { user: actor, access: actorAccess } = await requireAppCapability(input.applicationId, "manage");
    const password = input.password ?? "";
    const displayName = input.displayName?.trim() ?? "";
    // Joget and SSO match people by email, so every invite is by email.
    if (!input.identity.includes("@")) return { error: "Enter their email." };
    if (password) {
      const problem = passwordProblem(password);
      if (problem) return { error: problem };
    }
    const user = await ensureDirectoryUser(input.identity);
    if (password || displayName) {
      const locked = await accountLockReason(actor, user.id, input.applicationId);
      if (locked) return { error: locked };
    }
    const db = await getDb();
    const { data: app, error: appError } = await db
      .from("applications")
      .select("owner_user_id")
      .eq("id", input.applicationId)
      .maybeSingle();
    if (appError) return { error: appError.message };
    if (!app) return { error: "Application not found." };
    if (app.owner_user_id === user.id) {
      return { error: "That person already owns this application." };
    }

    const accessRoles = await loadAccessRoles(input.applicationId);
    if (accessRoles) {
      if (user.id === actor.id && !actor.is_superadmin) {
        return { error: OWN_ROLE_MESSAGE };
      }
      const role = assignableRole(accessRoles, input.accessRoleId ?? "", actorAccess);
      const existing = await db
        .from("application_members")
        .select("access_role_id")
        .eq("application_id", input.applicationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing.error) return { error: accessErrorMessage(existing.error) };
      assertCanChangeHolder(
        accessRoles,
        (existing.data?.access_role_id as string | null) ?? null,
        actorAccess
      );
      // A blank job title keeps the one already on the account, such as one from Joget.
      const title = await resolveJobTitle(input.ldapRole);
      if (title) {
        const { error: userError } = await db
          .from("hub_users")
          .update({ ldap_role: title })
          .eq("id", user.id);
        if (userError) return { error: accessErrorMessage(userError) };
      }
      const { error } = await db.from("application_members").upsert(
        {
          application_id: input.applicationId,
          user_id: user.id,
          ...membershipRoleColumns(role),
        },
        { onConflict: "application_id,user_id" }
      );
      if (error) return { error: accessErrorMessage(error) };
      const signInError = await writeSignIn(user.id, { displayName, password });
      if (signInError) return { error: signInError };
      revalidateApplication(input.applicationId);
      return {};
    }

    // Before migration 026: the job title group decides what they can do.
    const trimmedRole = input.ldapRole.trim();
    let storedRole: string | null = null;
    let band: "EDITOR" | "HOD" = "EDITOR";
    if (trimmedRole) {
      const orgRoles = await loadOrgRoleMap();
      if (!orgRoles) return { error: "Run migration 012_org_role_map.sql from Setup." };
      const title = mappedTitle(trimmedRole, orgRoles);
      if (!title) return { error: "Add that role on the Roles page before assigning it." };
      storedRole = title;
      const mapped = bandForLdapRole(title, orgRoles);
      band = mapped === "ADMIN" ? "HOD" : mapped;
    }
    const caps = capabilitiesForRole(band);
    const { error: userError } = await db
      .from("hub_users")
      .update({ ldap_role: storedRole })
      .eq("id", user.id);
    if (userError) return { error: accessErrorMessage(userError) };
    const { error } = await db.from("application_members").upsert(
      {
        application_id: input.applicationId,
        user_id: user.id,
        role: band,
        can_edit: caps.can_edit,
        can_approve: caps.can_approve,
      },
      { onConflict: "application_id,user_id" }
    );
    if (error) return { error: accessErrorMessage(error) };
    const signInError = await writeSignIn(user.id, { displayName, password });
    if (signInError) return { error: signInError };
    revalidateApplication(input.applicationId);
    return {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not invite this person.",
    };
  }
}

export async function setApplicationMemberPassword(input: {
  applicationId: string;
  membershipId: string;
  password: string;
}): Promise<{ error?: string }> {
  try {
    const { user: actor } = await requireAppCapability(input.applicationId, "manage");
    const problem = passwordProblem(input.password);
    if (problem) return { error: problem };
    const db = await getDb();
    const { data: member, error: memberError } = await db
      .from("application_members")
      .select("user:hub_users(id, email)")
      .eq("id", input.membershipId)
      .eq("application_id", input.applicationId)
      .maybeSingle();
    if (memberError) return { error: accessErrorMessage(memberError) };
    const target = (Array.isArray(member?.user) ? member.user[0] : member?.user) as
      | { id: string; email: string | null }
      | null
      | undefined;
    if (!target) return { error: "That person is not on this application." };
    if (!target.email) {
      return { error: "This person has no email, so they cannot sign in with a password." };
    }
    const locked = await accountLockReason(actor, target.id, input.applicationId);
    if (locked) return { error: locked };
    const signInError = await writeSignIn(target.id, { password: input.password });
    if (signInError) return { error: signInError };
    return {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not set the password.",
    };
  }
}

export async function updateApplicationMember(input: {
  applicationId: string;
  membershipId: string;
  ldapRole: string;
  accessRoleId?: string;
}): Promise<void> {
  const { user: actor, access: actorAccess } = await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const { data: member, error: memberError } = await db
    .from("application_members")
    .select("user_id")
    .eq("id", input.membershipId)
    .eq("application_id", input.applicationId)
    .maybeSingle();
  if (memberError) throw new Error(accessErrorMessage(memberError));
  if (!member?.user_id) throw new Error("That person is not on this application.");

  const accessRoles = await loadAccessRoles(input.applicationId);
  if (!accessRoles) {
    await assignLdapRole(member.user_id as string, input.ldapRole);
    revalidateApplication(input.applicationId);
    return;
  }

  const role = assignableRole(accessRoles, input.accessRoleId ?? "", actorAccess);
  const title = await resolveJobTitle(input.ldapRole);
  const current = await db
    .from("application_members")
    .select("access_role_id")
    .eq("id", input.membershipId)
    .maybeSingle();
  if (current.error) throw new Error(accessErrorMessage(current.error));
  const currentRoleId = (current.data?.access_role_id as string | null) ?? null;
  if (member.user_id === actor.id && !actor.is_superadmin && currentRoleId !== role.id) {
    throw new Error(OWN_ROLE_MESSAGE);
  }
  assertCanChangeHolder(accessRoles, currentRoleId, actorAccess);
  const { error: userError } = await db
    .from("hub_users")
    .update({ ldap_role: title })
    .eq("id", member.user_id);
  if (userError) throw new Error(accessErrorMessage(userError));
  const { error } = await db
    .from("application_members")
    .update(membershipRoleColumns(role))
    .eq("id", input.membershipId)
    .eq("application_id", input.applicationId);
  if (error) throw new Error(accessErrorMessage(error));
  revalidateApplication(input.applicationId);
}

export async function removeApplicationMember(input: {
  applicationId: string;
  membershipId: string;
}): Promise<void> {
  const { access } = await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const accessRoles = await loadAccessRoles(input.applicationId);
  if (accessRoles) {
    const current = await db
      .from("application_members")
      .select("access_role_id")
      .eq("id", input.membershipId)
      .eq("application_id", input.applicationId)
      .maybeSingle();
    if (current.error) throw new Error(accessErrorMessage(current.error));
    assertCanChangeHolder(
      accessRoles,
      (current.data?.access_role_id as string | null) ?? null,
      access
    );
  }
  const { error } = await db
    .from("application_members")
    .delete()
    .eq("id", input.membershipId)
    .eq("application_id", input.applicationId);
  if (error) throw new Error(error.message);
  revalidateApplication(input.applicationId);
}

export async function setApplicationOwner(input: {
  applicationId: string;
  identity: string;
}): Promise<{ error?: string }> {
  try {
    await requireSuperadmin();
    const user = await ensureDirectoryUser(input.identity);
    const db = await getDb();
    const { error: memberError } = await db
      .from("application_members")
      .delete()
      .eq("application_id", input.applicationId)
      .eq("user_id", user.id);
    if (memberError) return { error: memberError.message };
    const { error } = await db
      .from("applications")
      .update({ owner_user_id: user.id })
      .eq("id", input.applicationId);
    if (error) return { error: error.message };
    revalidateApplication(input.applicationId);
    return {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not set the owner.",
    };
  }
}
