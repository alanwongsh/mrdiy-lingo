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
  revalidateApplication(id);
  return data as Application;
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

export async function inviteApplicationMember(input: {
  applicationId: string;
  identity: string;
  ldapRole: string;
}): Promise<{ error?: string }> {
  try {
    await requireAppCapability(input.applicationId, "manage");
    const user = await ensureDirectoryUser(input.identity);
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
    revalidateApplication(input.applicationId);
    return {};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not invite this person.",
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
