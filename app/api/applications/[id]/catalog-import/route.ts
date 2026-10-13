import { getActor } from "@/lib/auth/actor";
import { requireAppCapability } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { parseSpreadsheet } from "@/lib/import/parse";
import { normalizeItemCode, type ItemImportResult } from "@/lib/catalog";
import {
  applyTextValues,
  loadItemFields,
  loadItemValues,
  recordItemEvent,
  reopenIfApproved,
  revalidateItem,
  throwItemError,
} from "@/lib/catalog-store";
import type { CatalogItem } from "@/lib/types";

const MAX_ROWS = 2000;

function splitList(value: string): string[] {
  return value
    .split(/[,;|\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Imports items from CSV or Excel. A row whose code exists updates that item; any other row
 * creates one as a draft. Columns: item, name, source_language, target_languages, one column per
 * field code for the source text, and {language}_{field code} for a translation.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: applicationId } = await context.params;
    const grant = await requireAppCapability(applicationId, "content.import");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV or Excel file.");
    const defaultSource = String(form.get("sourceLanguage") ?? "en").trim() || "en";

    const rows = parseSpreadsheet(await file.arrayBuffer(), file.name);
    if (rows.length < 2) throw new Error("The file needs a header row and at least one item.");
    if (rows.length - 1 > MAX_ROWS) throw new Error(`Import up to ${MAX_ROWS} items at a time.`);

    const db = await getDb();
    const [fields, languagesResult] = await Promise.all([
      loadItemFields(applicationId),
      db.from("languages").select("code").eq("status", "ACTIVE"),
    ]);
    if (languagesResult.error) throw new Error(languagesResult.error.message);
    const languages = (languagesResult.data ?? []).map((l) => l.code as string);
    const languageByLower = new Map(languages.map((code) => [code.toLowerCase(), code]));
    const textFields = fields;
    const fieldByCode = new Map(textFields.map((f) => [f.code.toLowerCase(), f]));

    const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
    const codeIdx = header.indexOf("code");
    if (codeIdx < 0) throw new Error("The header needs a 'code' column.");
    const nameIdx = header.indexOf("name");
    const sourceIdx = header.indexOf("source_language");
    const targetsIdx = header.indexOf("target_languages");

    // column index -> { field, language | null (source) }
    const columns: { index: number; fieldId: string; language: string | null }[] = [];
    const ignoredColumns: string[] = [];
    header.forEach((name, index) => {
      if ([codeIdx, nameIdx, sourceIdx, targetsIdx].includes(index) || !name) return;
      const direct = fieldByCode.get(name);
      if (direct) {
        columns.push({ index, fieldId: direct.id, language: null });
        return;
      }
      for (const [lower, code] of languageByLower) {
        if (!name.startsWith(`${lower}_`)) continue;
        const field = fieldByCode.get(name.slice(lower.length + 1));
        if (field) {
          columns.push({ index, fieldId: field.id, language: code });
          return;
        }
      }
      ignoredColumns.push(rows[0][index]);
    });

    const body = rows.slice(1);
    const codes = [...new Set(body.map((r) => normalizeItemCode(String(r[codeIdx] ?? ""))).filter(Boolean))];
    const existing = new Map<string, CatalogItem>();
    for (let i = 0; i < codes.length; i += 200) {
      const { data, error } = await db
        .from("catalog_items")
        .select("*")
        .eq("application_id", applicationId)
        .in("item_code", codes.slice(i, i + 200));
      if (error) throwItemError(error);
      for (const item of (data ?? []) as CatalogItem[]) existing.set(item.item_code, item);
    }
    const existingValues = await loadItemValues([...existing.values()].map((s) => s.id));
    const actor = await getActor();
    const result: ItemImportResult = { created: 0, updated: 0, unchanged: 0, errors: [], ignoredColumns };
    const seen = new Set<string>();

    for (let r = 0; r < body.length; r += 1) {
      const row = body[r];
      const rowNumber = r + 2;
      const cell = (index: number) => (index >= 0 ? String(row[index] ?? "").trim() : "");
      try {
        const code = normalizeItemCode(cell(codeIdx));
        if (!code) throw new Error("Code is empty.");
        if (seen.has(code)) throw new Error(`${code} appears more than once in the file.`);
        seen.add(code);

        let found = existing.get(code) ?? null;
        const isNew = !found;
        if (!found) {
          const source = languageByLower.get(cell(sourceIdx).toLowerCase()) ?? defaultSource;
          const listed = splitList(cell(targetsIdx))
            .map((t) => languageByLower.get(t.toLowerCase()))
            .filter((t): t is string => !!t);
          const targets = (listed.length > 0 ? listed : languages).filter((t) => t !== source);
          const { data, error } = await db
            .from("catalog_items")
            .insert({
              application_id: applicationId,
              item_code: code,
              name: cell(nameIdx),
              source_language: source,
              target_languages: [...new Set(targets)],
              status: "DRAFT",
              created_by_name: actor?.name ?? null,
              created_by_username: actor?.username ?? null,
            })
            .select("*")
            .single();
          if (error) throwItemError(error);
          found = data as CatalogItem;
        } else if (nameIdx >= 0 && cell(nameIdx) && cell(nameIdx) !== found.name) {
          const { error } = await db.from("catalog_items").update({ name: cell(nameIdx) }).eq("id", found.id);
          if (error) throwItemError(error);
        }
        const item: CatalogItem = found;

        let values = existingValues.filter((v) => v.item_id === item.id);
        let changed = 0;
        let unapproved = 0;
        // Source first, so translations are hashed against the new source text.
        const groups = new Map<string, { fieldId: string; text: string }[]>();
        for (const column of columns) {
          const text = cell(column.index);
          if (!text) continue;
          const language = column.language ?? item.source_language;
          if (language !== item.source_language && !item.target_languages.includes(language)) continue;
          const list = groups.get(language) ?? [];
          list.push({ fieldId: column.fieldId, text });
          groups.set(language, list);
        }
        const ordered = [...groups.entries()].sort(([a], [b]) =>
          a === item.source_language ? -1 : b === item.source_language ? 1 : 0
        );
        for (const [language, changes] of ordered) {
          const applied = await applyTextValues({
            item,
            fields,
            values,
            languageCode: language,
            changes,
            sourceType: "IMPORT",
            approver: false,
          });
          changed += applied.changed.length;
          unapproved += applied.unapproved;
          if (language === item.source_language && applied.changed.length > 0) {
            values = await loadItemValues([item.id]);
          }
        }

        if (isNew) {
          result.created += 1;
          await recordItemEvent({
            item,
            event: "CREATED",
            userId: grant.user.id,
            toStatus: "DRAFT",
            detail: { import: file.name },
          });
        } else if (changed > 0) {
          result.updated += 1;
          await recordItemEvent({
            item,
            event: "EDITED",
            userId: grant.user.id,
            detail: { import: file.name, values: changed },
          });
          if (unapproved > 0) await reopenIfApproved(item, "Updated by import", grant.user.id);
        } else {
          result.unchanged += 1;
        }
      } catch (error) {
        result.errors.push({
          row: rowNumber,
          message: error instanceof Error ? error.message : "Row failed.",
        });
      }
    }

    revalidateItem(applicationId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    const status = /permission|sign in|access/i.test(message) ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
