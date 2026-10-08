import { getDb } from "@/lib/db/client";
import { throwPublishError } from "@/lib/publish/errors";
import { languageKey } from "@/lib/target-languages";
import type { EntityStatus, PublishLanguageTarget } from "@/lib/types";

export type VendorRow = {
  id: string;
  application_id: string;
  name: string;
  type_code: string;
  config: unknown;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
};

export type PublicationRow = {
  id: string;
  content_id: string;
  vendor_id: string;
  language_code: string;
  status: "PENDING" | "PUBLISHED" | "FAILED";
  external_url: string | null;
  error_message: string | null;
  published_at: string | null;
  attempted_at: string | null;
};

export async function replaceArticlePublishTargets(
  contentId: string,
  applicationId: string,
  targets: PublishLanguageTarget[],
  allowedLanguages: string[]
) {
  const db = await getDb();
  const allowed = new Map(allowedLanguages.map((code) => [languageKey(code), code.trim()]));
  const rows: { content_id: string; language_code: string; vendor_id: string }[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const language = allowed.get(languageKey(target.language_code));
    const vendorId = target.vendor_id.trim();
    if (!language || !vendorId) throw new Error("Choose a language and a provider on this article.");
    const key = `${languageKey(language)}:${vendorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ content_id: contentId, language_code: language, vendor_id: vendorId });
  }

  const vendorIds = [...new Set(rows.map((row) => row.vendor_id))];
  if (vendorIds.length > 0) {
    const { data, error } = await db
      .from("publish_vendors")
      .select("id")
      .eq("application_id", applicationId)
      .in("id", vendorIds);
    if (error) throwPublishError(error);
    if ((data ?? []).length !== vendorIds.length) {
      throw new Error("Choose providers from this application.");
    }
  }

  const { error: deleteError } = await db
    .from("content_publish_targets")
    .delete()
    .eq("content_id", contentId);
  if (deleteError) throwPublishError(deleteError);
  if (rows.length > 0) {
    const { error: insertError } = await db.from("content_publish_targets").insert(rows);
    if (insertError) throwPublishError(insertError);
  }

  const { error: touchError } = await db
    .from("content")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", contentId);
  if (touchError) throw new Error(touchError.message);
}

export async function listVendorRows(applicationId: string): Promise<VendorRow[]> {
  const db = await getDb();
  const { data, error } = await db
    .from("publish_vendors")
    .select("*")
    .eq("application_id", applicationId)
    .order("name", { ascending: true });
  if (error) throwPublishError(error);
  return (data ?? []) as VendorRow[];
}

export async function listPublishTargets(contentId: string): Promise<PublishLanguageTarget[]> {
  const db = await getDb();
  const { data, error } = await db
    .from("content_publish_targets")
    .select("language_code, vendor_id")
    .eq("content_id", contentId);
  if (error) throwPublishError(error);
  return (data ?? []).map((row) => ({
    language_code: String(row.language_code),
    vendor_id: String(row.vendor_id),
  }));
}

export async function listPublicationRows(contentId: string): Promise<PublicationRow[]> {
  const db = await getDb();
  const { data, error } = await db
    .from("content_publications")
    .select(
      "id, content_id, vendor_id, language_code, status, external_url, error_message, published_at, attempted_at"
    )
    .eq("content_id", contentId);
  if (error) throwPublishError(error);
  return (data ?? []) as PublicationRow[];
}

export function normalizeVendorName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter a vendor name.");
  if (name.length > 80) throw new Error("Vendor name must be 80 characters or fewer.");
  return name;
}
