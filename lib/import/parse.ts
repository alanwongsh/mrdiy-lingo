import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  DEFAULT_CONTENT_TYPE_CODE,
  normalizeContentTypeCode,
} from "@/lib/content-types";
import type { SourceContentFields } from "@/lib/types";

export type StringImportRow = {
  namespace: string;
  key: string;
  translations: Record<string, string>;
  rowNumber: number;
};

export type StringImportPreviewItem = StringImportRow & {
  action: "NEW" | "UPDATED" | "UNCHANGED" | "ERROR";
  error?: string;
  existingKeyId?: string;
};

export type ArticleImportRow = {
  title: string;
  source_language: string;
  content_type: string;
  status: string;
  fields: SourceContentFields;
  translations: Record<string, Partial<SourceContentFields>>;
  rowNumber: number;
};

export type ArticleImportPreviewItem = ArticleImportRow & {
  action: "NEW" | "UPDATED" | "UNCHANGED" | "ERROR";
  error?: string;
  existingContentId?: string;
};

function parseSpreadsheet(buffer: ArrayBuffer, filename: string): string[][] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buffer);
    const parsed = Papa.parse<string[]>(text, {
      skipEmptyLines: true,
    });
    if (parsed.errors.length) {
      throw new Error(parsed.errors[0]?.message ?? "CSV parse error");
    }
    return (parsed.data ?? []).filter((row) =>
      row.some((cell) => String(cell ?? "").trim() !== "")
    );
  }

  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
  });
  return rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
}

export function parseStringTranslationFile(
  buffer: ArrayBuffer,
  filename: string
): StringImportRow[] {
  const rows = parseSpreadsheet(buffer, filename);
  if (rows.length < 2) throw new Error("File must include a header and at least one row");

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const namespaceIdx = header.indexOf("namespace");
  const keyIdx = header.indexOf("key");
  if (namespaceIdx < 0 || keyIdx < 0) {
    throw new Error("Header must include 'namespace' and 'key' columns");
  }

  const langColumns = header
    .map((name, index) => ({ name, index }))
    .filter(
      ({ name, index }) =>
        index !== namespaceIdx &&
        index !== keyIdx &&
        name.length > 0
    );

  const result: StringImportRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const namespace = String(row[namespaceIdx] ?? "").trim();
    const key = String(row[keyIdx] ?? "").trim();
    if (!namespace && !key) continue;
    const translations: Record<string, string> = {};
    for (const col of langColumns) {
      const value = String(row[col.index] ?? "").trim();
      if (value) translations[col.name] = value;
    }
    result.push({
      namespace,
      key,
      translations,
      rowNumber: i + 1,
    });
  }
  return result;
}

/**
 * Press CSV/XLSX format (flat):
 * title,source_language,content_type,status,summary,body,seo_title,seo_description,ms_title,ms_summary,ms_body,...
 */
export function parseArticleTranslationFile(
  buffer: ArrayBuffer,
  filename: string
): ArticleImportRow[] {
  const rows = parseSpreadsheet(buffer, filename);
  if (rows.length < 2) throw new Error("File must include a header and at least one row");

  const headerRaw = rows[0].map((h) => h.trim());
  const header = headerRaw.map((h) => h.toLowerCase());
  const required = ["title", "source_language"];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new Error(`Header must include '${col}'`);
    }
  }

  const idx = (name: string) => header.indexOf(name);
  const titleIdx = idx("title");
  const sourceLangIdx = idx("source_language");
  const typeIdx = idx("content_type");
  const statusIdx = idx("status");

  const translationCols = headerRaw
    .map((name, index) => {
      const match = name.match(
        /^([A-Za-z]{2}(?:-[A-Za-z]+)?)_(title|summary|body|seo_title|seo_description)$/i
      );
      if (!match) return null;
      return {
        index,
        lang: match[1],
        field: match[2].toLowerCase() as keyof SourceContentFields,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const result: ArticleImportRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const title = String(row[titleIdx] ?? "").trim();
    if (!title) continue;
    const source_language = String(row[sourceLangIdx] ?? "en").trim() || "en";
    const fields: SourceContentFields = {
      title,
      summary: String(row[idx("summary")] ?? "").trim(),
      body: String(row[idx("body")] ?? "").trim(),
      seo_title: String(row[idx("seo_title")] ?? "").trim(),
      seo_description: String(row[idx("seo_description")] ?? "").trim(),
    };

    const translations: Record<string, Partial<SourceContentFields>> = {};
    for (const col of translationCols) {
      const value = String(row[col.index] ?? "").trim();
      if (!value) continue;
      translations[col.lang] ??= {};
      translations[col.lang][col.field] = value;
    }

    result.push({
      title,
      source_language,
      content_type:
        normalizeContentTypeCode(
          typeIdx >= 0 ? String(row[typeIdx] ?? "") : ""
        ) || DEFAULT_CONTENT_TYPE_CODE,
      status: String(row[statusIdx] ?? "DRAFT").trim() || "DRAFT",
      fields,
      translations,
      rowNumber: i + 1,
    });
  }
  return result;
}

export function summarizePreview<T extends { action: string }>(items: T[]) {
  return {
    new: items.filter((i) => i.action === "NEW").length,
    updated: items.filter((i) => i.action === "UPDATED").length,
    unchanged: items.filter((i) => i.action === "UNCHANGED").length,
    errors: items.filter((i) => i.action === "ERROR").length,
    total: items.length,
  };
}
