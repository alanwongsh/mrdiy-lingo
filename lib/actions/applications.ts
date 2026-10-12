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
  bandForLdapRole,
  loadOrgRoleMap,
  normalizeLdapRole,
} from "@/lib/auth/org-roles";
import {
  capabilitiesForRole,
  parseAppRole,
  roleFromApprovalFlag,
} from "@/lib/auth/roles";
import { hashPassword } from "@/lib/auth/password";
import { ensureDefaultContentType } from "@/lib/actions/content-types";
import { getDb } from "@/lib/db/client";
import type {
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
}): Promise<Application> {
  const user = await requireUser();
  const db = await getDb();
  const { data, error } = await db
    .from("applications")
    .insert({
      name: input.name.trim(),
      description: input.description.trim(),
      model_type: input.model_type,
      status: "ACTIVE",
      owner_user_id: user.id,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const application = data as Application;
  if (application.model_type === "CONTENT") {
    await ensureDefaultContentType(application.id);
  }
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
  await requireAppCapability(id, "manage");
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
  revalidateApplication(id);
  return application;
}

export async function setApplicationStatus(
  id: string,
  status: EntityStatus
): Promise<void> {
  await requireAppCapability(id, "manage");
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
  await requireAppCapability(id, "approve");
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
  revalidatePath(`/applications/${id}/settings/notifications`);
}

export async function listApplicationPeople(applicationId: string): Promise<{
  owner: ApplicationMemberView | null;
  members: ApplicationMemberView[];
  orgRoles: Awaited<ReturnType<typeof loadOrgRoleMap>>;
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
        role: null,
        canEdit: true,
        canApprove: true,
      };
    }
  }

  const listed = await db
    .from("application_members")
    .select("id, role, can_edit, can_approve, user:hub_users(*)")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  let rows = listed.data;
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
  const members = (rows ?? []).flatMap((row) => {
    const user = (Array.isArray(row.user) ? row.user[0] : row.user) as HubUser | null;
    if (!user) return [];
    const stored =
      parseAppRole(row.role) ?? roleFromApprovalFlag(!!row.can_approve);
    const role = orgRoles ? bandForLdapRole(user.ldap_role, orgRoles) : stored;
    const caps = capabilitiesForRole(role === "ADMIN" ? "HOD" : role);
    return [
      {
        membershipId: row.id as string,
        userId: user.id,
        displayName: user.display_name,
        detail: personDetail(user),
        ldapRole: user.ldap_role ?? null,
        role,
        canEdit: orgRoles ? caps.can_edit : !!row.can_edit,
        canApprove: orgRoles ? caps.can_approve : !!row.can_approve,
      },
    ];
  });

  return { owner, members, orgRoles };
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
  displayName?: string;
  password?: string;
}): Promise<{ error?: string }> {
  try {
    const { user: actor } = await requireAppCapability(input.applicationId, "manage");
    const password = input.password ?? "";
    const displayName = input.displayName?.trim() ?? "";
    if (password) {
      if (!input.identity.includes("@")) {
        return { error: "Enter an email to give this person a sign-in password." };
      }
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
}): Promise<void> {
  await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const { data: member, error: memberError } = await db
    .from("application_members")
    .select("user_id")
    .eq("id", input.membershipId)
    .eq("application_id", input.applicationId)
    .maybeSingle();
  if (memberError) throw new Error(accessErrorMessage(memberError));
  if (!member?.user_id) throw new Error("That person is not on this application.");
  await assignLdapRole(member.user_id as string, input.ldapRole);
  revalidateApplication(input.applicationId);
}

export async function removeApplicationMember(input: {
  applicationId: string;
  membershipId: string;
}): Promise<void> {
  await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
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
