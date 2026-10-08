"use server";

import { revalidatePath } from "next/cache";
import { requireAppCapability, requireContentAccess } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { publishSchemaError, throwPublishError } from "@/lib/publish/errors";
import { readConfig } from "@/lib/publish/integrations/integration";
import { getPublishIntegration, listPublishIntegrations } from "@/lib/publish/integrations/registry";
import { publishContentNow, type PublishRunResult } from "@/lib/publish/run";
import {
  listPublicationRows,
  listPublishTargets,
  listVendorRows,
  normalizeVendorName,
  replaceArticlePublishTargets,
  type VendorRow,
} from "@/lib/publish/store";
import type {
  ContentPublication,
  EntityStatus,
  PublishLanguageTarget,
  PublishVendor,
  PublishVendorChoice,
} from "@/lib/types";
import type { PublishIntegrationType } from "@/lib/publish/integrations/integration";

export type ArticlePublishState = {
  ready: boolean;
  notice: string;
  vendors: PublishVendorChoice[];
  targets: PublishLanguageTarget[];
  publications: ContentPublication[];
};

function canConfigure(access: { can_approve: boolean; can_manage: boolean }) {
  return access.can_approve || access.can_manage;
}

async function requireVendorAdmin(applicationId: string) {
  const grant = await requireAppCapability(applicationId, "view");
  if (!canConfigure(grant.access)) {
    throw new Error("Vendor settings are limited to HOD and above.");
  }
  return grant;
}

function toVendor(row: VendorRow, includeConfig: boolean): PublishVendor {
  const integration = getPublishIntegration(row.type_code);
  const stored = readConfig(row.config);
  const config: Record<string, string> = {};
  const savedSecrets: string[] = [];
  for (const field of integration?.credentials ?? []) {
    const value = stored[field.key] ?? "";
    if (field.input === "secret") {
      if (value.trim()) savedSecrets.push(field.key);
      continue;
    }
    if (includeConfig) config[field.key] = value;
  }
  return {
    id: row.id,
    application_id: row.application_id,
    name: row.name,
    type_code: row.type_code,
    config,
    saved_secrets: savedSecrets,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listPublishIntegrationTypes(): Promise<PublishIntegrationType[]> {
  return listPublishIntegrations();
}

export async function listPublishVendors(applicationId: string): Promise<PublishVendor[]> {
  const grant = await requireAppCapability(applicationId, "view");
  const includeEndpoint = canConfigure(grant.access);
  const rows = await listVendorRows(applicationId);
  return rows.map((row) => toVendor(row, includeEndpoint));
}

export async function getArticlePublish(contentId: string): Promise<ArticlePublishState> {
  const grant = await requireContentAccess(contentId, "view");
  try {
    const [vendors, targets, publications] = await Promise.all([
      listVendorRows(grant.applicationId),
      listPublishTargets(contentId),
      listPublicationRows(contentId),
    ]);
    const names = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
    return {
      ready: true,
      notice: "",
      vendors: vendors.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        status: vendor.status,
      })),
      targets,
      publications: publications.map((row) => ({
        id: row.id,
        content_id: row.content_id,
        vendor_id: row.vendor_id,
        vendor_name: names.get(row.vendor_id) ?? "Provider",
        language_code: row.language_code,
        status: row.status,
        external_url: row.external_url,
        error_message: row.error_message,
        published_at: row.published_at,
      })),
    };
  } catch (error) {
    const schema = error instanceof Error ? publishSchemaError({ message: error.message }) : null;
    if (
      !schema &&
      !(error instanceof Error && /016_publish_vendors|017_publish_language_targets/.test(error.message))
    ) {
      throw error;
    }
    return {
      ready: false,
      notice:
        schema?.message ??
        "Run migration 017_publish_language_targets.sql from Setup before publishing.",
      vendors: [],
      targets: [],
      publications: [],
    };
  }
}

export async function savePublishVendor(input: {
  applicationId: string;
  id?: string;
  name: string;
  typeCode: string;
  config: Record<string, string>;
  clearSecrets?: string[];
  status: EntityStatus;
}): Promise<void> {
  await requireVendorAdmin(input.applicationId);
  const integration = getPublishIntegration(input.typeCode);
  if (!integration) throw new Error("Choose an integration type.");
  const name = normalizeVendorName(input.name);
  const status = input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const db = await getDb();

  let previous: Record<string, string> = {};
  if (input.id) {
    const { data: current, error: currentError } = await db
      .from("publish_vendors")
      .select("id, type_code, config")
      .eq("id", input.id)
      .eq("application_id", input.applicationId)
      .maybeSingle();
    if (currentError) throwPublishError(currentError);
    if (!current) throw new Error("Vendor not found.");
    if (current.type_code !== input.typeCode) {
      throw new Error("The integration type cannot be changed.");
    }
    previous = readConfig(current.config);
    for (const key of input.clearSecrets ?? []) delete previous[key];
  }

  const config = integration.validateConfig(input.config ?? {}, previous);
  if (!input.id) {
    const { error } = await db.from("publish_vendors").insert({
      application_id: input.applicationId,
      name,
      type_code: integration.code,
      config,
      status,
    });
    if (error) {
      if (error.code === "23505") throw new Error("This application already has a vendor with that name.");
      throwPublishError(error);
    }
  } else {
    const { error } = await db
      .from("publish_vendors")
      .update({ name, config, status })
      .eq("id", input.id)
      .eq("application_id", input.applicationId);
    if (error) {
      if (error.code === "23505") throw new Error("This application already has a vendor with that name.");
      throwPublishError(error);
    }
  }

  revalidatePath(`/applications/${input.applicationId}/settings/publish`);
  revalidatePath(`/applications/${input.applicationId}/articles`);
}

export async function publishArticleNow(
  contentId: string,
  applicationId: string,
  targets: PublishLanguageTarget[]
): Promise<PublishRunResult> {
  const grant = await requireContentAccess(contentId, "edit");
  if (grant.applicationId !== applicationId) throw new Error("Article not found.");
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select("source_language, target_languages, status")
    .eq("id", contentId)
    .single();
  if (error) throw new Error(error.message);
  if (data.status !== "APPROVED" && data.status !== "PUBLISHED") {
    throw new Error("Approve the article before publishing.");
  }
  await replaceArticlePublishTargets(contentId, applicationId, targets, [
    String(data.source_language ?? ""),
    ...((data.target_languages ?? []) as string[]),
  ]);
  const result = await publishContentNow(contentId);
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/applications/${applicationId}/articles/${contentId}`);
  return result;
}

export async function deletePublishVendor(id: string, applicationId: string): Promise<void> {
  await requireVendorAdmin(applicationId);
  const db = await getDb();
  const { error } = await db
    .from("publish_vendors")
    .delete()
    .eq("id", id)
    .eq("application_id", applicationId);
  if (error) throwPublishError(error);
  revalidatePath(`/applications/${applicationId}/settings/publish`);
  revalidatePath(`/applications/${applicationId}/articles`);
}
