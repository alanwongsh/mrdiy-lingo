"use server";

import { revalidatePath } from "next/cache";
import {
  ensureDirectoryUser,
  personDetail,
  requireAppCapability,
  requireSuperadmin,
  requireUser,
  resolveAppAccess,
} from "@/lib/auth/access";
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
        canEdit: true,
        canApprove: true,
      };
    }
  }

  const { data: rows, error } = await db
    .from("application_members")
    .select("id, can_edit, can_approve, user:hub_users(*)")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const members = (rows ?? []).flatMap((row) => {
    const user = (Array.isArray(row.user) ? row.user[0] : row.user) as HubUser | null;
    if (!user) return [];
    return [
      {
        membershipId: row.id as string,
        userId: user.id,
        displayName: user.display_name,
        detail: personDetail(user),
        canEdit: !!row.can_edit,
        canApprove: !!row.can_approve,
      },
    ];
  });

  return { owner, members };
}

export async function inviteApplicationMember(input: {
  applicationId: string;
  identity: string;
  canEdit: boolean;
  canApprove: boolean;
}): Promise<void> {
  await requireAppCapability(input.applicationId, "manage");
  const user = await ensureDirectoryUser(input.identity);
  const db = await getDb();
  const { data: app, error: appError } = await db
    .from("applications")
    .select("owner_user_id")
    .eq("id", input.applicationId)
    .maybeSingle();
  if (appError) throw new Error(appError.message);
  if (!app) throw new Error("Application not found.");
  if (app.owner_user_id === user.id) {
    throw new Error("That person already owns this application.");
  }

  const { error } = await db.from("application_members").upsert(
    {
      application_id: input.applicationId,
      user_id: user.id,
      can_edit: input.canEdit,
      can_approve: input.canApprove,
    },
    { onConflict: "application_id,user_id" }
  );
  if (error) throw new Error(error.message);
  revalidateApplication(input.applicationId);
}

export async function updateApplicationMember(input: {
  applicationId: string;
  membershipId: string;
  canEdit: boolean;
  canApprove: boolean;
}): Promise<void> {
  await requireAppCapability(input.applicationId, "manage");
  const db = await getDb();
  const { error } = await db
    .from("application_members")
    .update({
      can_edit: input.canEdit,
      can_approve: input.canApprove,
    })
    .eq("id", input.membershipId)
    .eq("application_id", input.applicationId);
  if (error) throw new Error(error.message);
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
}): Promise<void> {
  await requireSuperadmin();
  const user = await ensureDirectoryUser(input.identity);
  const db = await getDb();
  const { error: memberError } = await db
    .from("application_members")
    .delete()
    .eq("application_id", input.applicationId)
    .eq("user_id", user.id);
  if (memberError) throw new Error(memberError.message);
  const { error } = await db
    .from("applications")
    .update({ owner_user_id: user.id })
    .eq("id", input.applicationId);
  if (error) throw new Error(error.message);
  revalidateApplication(input.applicationId);
}
