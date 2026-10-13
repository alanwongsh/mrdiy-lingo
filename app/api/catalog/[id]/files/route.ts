import { randomUUID } from "crypto";
import { getActor } from "@/lib/auth/actor";
import { requireItemAccess } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { CATALOG_FILE_MAX_BYTES } from "@/lib/catalog";
import { extractFileText } from "@/lib/catalog-extract";
import {
  applyTextValues,
  loadItem,
  loadItemFields,
  loadItemValues,
  recordItemEvent,
  removeStoredFiles,
  reopenIfApproved,
  revalidateItem,
  CATALOG_BUCKET,
  throwItemError,
} from "@/lib/catalog-store";
import { manualSaveStatus } from "@/lib/types";

function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "Upload failed.";
  const status = /not found/i.test(message)
    ? 404
    : /permission|sign in|access/i.test(message)
      ? 403
      : 400;
  return Response.json({ error: message }, { status });
}

function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "");
  return (cleaned || "file").slice(-120);
}

/**
 * Uploads the file (image, PDF, Excel, Word, text) that is one field's source in one language,
 * replacing any previous file or typed text. Its words are read into the field so they are reviewed
 * and translated like typed text. A failed read keeps the upload and leaves the text empty.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const grant = await requireItemAccess(id, "edit");
    const item = await loadItem(id);
    if (!item) throw new Error("Item not found.");

    const form = await request.formData();
    const fieldId = String(form.get("fieldId") ?? "");
    const languageCode = String(form.get("languageCode") ?? "");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file.");
    if (file.size > CATALOG_FILE_MAX_BYTES) throw new Error("Files can be up to 4 MB.");

    const fields = await loadItemFields(item.application_id);
    const field = fields.find((f) => f.id === fieldId);
    if (!field) throw new Error("That field no longer exists. Reload the page.");
    const isSource = languageCode === item.source_language;
    if (!isSource && !item.target_languages.includes(languageCode)) {
      throw new Error("Add this language to this item first.");
    }
    if (!isSource && !field.translatable) {
      throw new Error(`${field.label} is shared by every language. Upload it in the source language.`);
    }

    const db = await getDb();
    const path = `${item.application_id}/${item.id}/${field.code}/${languageCode}/${randomUUID()}-${safeName(file.name)}`;
    const { error: uploadError } = await db.storage
      .from(CATALOG_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const values = await loadItemValues([item.id]);
    const existing = values.find((v) => v.field_id === field.id && v.language_code === languageCode);
    const status = manualSaveStatus(grant.access.can_approve, existing?.status);
    const keepStamp = status === "APPROVED" && existing?.status === "APPROVED";
    const actor = await getActor();
    const { error } = await db.from("catalog_values").upsert(
      {
        item_id: item.id,
        field_id: field.id,
        language_code: languageCode,
        file_path: path,
        file_name: file.name.slice(0, 200),
        file_mime: file.type || null,
        file_size: file.size,
        status,
        source_type: "MANUAL",
        updated_by_name: actor?.name ?? null,
        approved_by_username: keepStamp ? existing?.approved_by_username : null,
        approved_by_name: keepStamp ? existing?.approved_by_name : null,
        approved_by_user_id: keepStamp ? existing?.approved_by_user_id : null,
        approved_at: keepStamp ? existing?.approved_at : null,
      },
      { onConflict: "item_id,field_id,language_code" }
    );
    if (error) {
      await removeStoredFiles([path]);
      throwItemError(error);
    }
    if (existing?.file_path && existing.file_path !== path) {
      await removeStoredFiles([existing.file_path]);
    }

    await recordItemEvent({
      item,
      event: "EDITED",
      userId: grant.user.id,
      languageCode,
      detail: { fields: [field.label], file: file.name },
    });
    // One source per field: the file replaces any typed text, and its words become the text.
    let text = "";
    let readError: string | null = null;
    try {
      const read = await extractFileText(Buffer.from(await file.arrayBuffer()), file.type || "", file.name);
      text = read.text;
      if (!text) readError = "No readable text was found in the file. Type the text instead.";
    } catch (err) {
      readError = err instanceof Error ? err.message : "Could not read the file.";
    }
    const applied = await applyTextValues({
      item,
      fields,
      values,
      languageCode,
      changes: [{ fieldId: field.id, text }],
      sourceType: "IMPORT",
      approver: grant.access.can_approve,
    });
    const extracted = text ? text.length : 0;
    if (status !== "APPROVED" || applied.changed.length > 0) {
      await reopenIfApproved(item, `${field.label} replaced`, grant.user.id);
    }
    revalidateItem(item.application_id, item.id);
    return Response.json({ ok: true, extracted, readError, text });
  } catch (error) {
    return jsonError(error);
  }
}
