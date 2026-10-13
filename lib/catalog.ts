import type {
  ApplicationModelType,
  CatalogField,
  ItemStatus,
  CatalogValue,
} from "@/lib/types";

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  DRAFT: "Draft",
  REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
};

export type TemplateField = Pick<
  CatalogField,
  "code" | "label" | "translatable" | "required"
>;

/**
 * Starter setups for a new catalog. Each one only seeds the label and fields; owners can add,
 * rename, or switch fields off afterwards. Add a template here when another team onboards.
 */
export const CATALOG_TEMPLATES: {
  code: string;
  name: string;
  itemLabel: string;
  description: string;
  fields: TemplateField[];
}[] = [
  {
    code: "sku",
    name: "Products (SKU)",
    itemLabel: "SKU",
    description: "Customs and retail: product name, HS code, package text, manual, photo.",
    fields: [
      { code: "product_name", label: "Product name", translatable: true, required: true },
      { code: "hs_code", label: "HS code", translatable: false, required: true },
      { code: "hs_description", label: "HS description", translatable: true, required: false },
      { code: "package_description", label: "Package description", translatable: true, required: false },
      { code: "user_manual", label: "User manual", translatable: true, required: false },
      { code: "product_image", label: "Product image", translatable: false, required: false },
    ],
  },
  {
    code: "document",
    name: "Documents",
    itemLabel: "Document",
    description: "Policies, notices, and guides: title and body, typed or uploaded.",
    fields: [
      { code: "title", label: "Title", translatable: true, required: true },
      { code: "body", label: "Body", translatable: true, required: false },
    ],
  },
  {
    code: "blank",
    name: "Blank",
    itemLabel: "Item",
    description: "Start with a title only and add your own fields.",
    fields: [{ code: "title", label: "Title", translatable: true, required: true }],
  },
];

export function catalogTemplate(code: string | null | undefined) {
  return CATALOG_TEMPLATES.find((t) => t.code === code) ?? CATALOG_TEMPLATES[0];
}

/** What a catalog calls one record, such as SKU or Document. */
export function itemLabel(app: { item_label?: string | null }): string {
  return app.item_label?.trim() || "Item";
}

export function itemLabelPlural(app: { item_label?: string | null }): string {
  const label = itemLabel(app);
  return /s$/i.test(label) ? label : `${label}s`;
}

export const CATALOG_FILE_MAX_BYTES = 4 * 1024 * 1024;

/** Every field holds text and/or an upload. Only fields marked translatable go to the translator. */
export function isMachineTranslatable(field: Pick<CatalogField, "translatable">): boolean {
  return field.translatable;
}

export function normalizeFieldCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function normalizeItemCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase().slice(0, 80);
}

export function hasValue(value: Pick<CatalogValue, "text_value" | "file_path"> | undefined): boolean {
  return !!value && (value.text_value.trim() !== "" || !!value.file_path);
}

export type LanguageProgress = {
  /** Translatable text fields whose source has text. */
  total: number;
  approved: number;
  missing: number;
  /** Written from an older source text. */
  stale: number;
  complete: boolean;
};

/**
 * How far one target language is. Only translatable text counts: a language without its own
 * file falls back to the source file, so files never block approval.
 */
export function languageProgress(
  fields: CatalogField[],
  values: CatalogValue[],
  sourceLanguage: string,
  language: string
): LanguageProgress {
  const progress: LanguageProgress = { total: 0, approved: 0, missing: 0, stale: 0, complete: false };
  for (const field of fields) {
    if (field.status !== "ACTIVE" || !isMachineTranslatable(field)) continue;
    const source = values.find((v) => v.field_id === field.id && v.language_code === sourceLanguage);
    if (!source?.text_value.trim()) continue;
    progress.total += 1;
    const target = values.find((v) => v.field_id === field.id && v.language_code === language);
    if (!target?.text_value.trim()) {
      progress.missing += 1;
      continue;
    }
    if (isStale(source, target)) progress.stale += 1;
    else if (target.status === "APPROVED") progress.approved += 1;
  }
  progress.complete = progress.total > 0 && progress.approved === progress.total;
  return progress;
}

export function isStale(source: CatalogValue | undefined, target: CatalogValue | undefined): boolean {
  if (!source?.source_hash || !target?.source_hash) return false;
  return source.source_hash !== target.source_hash;
}

export function appHomePath(app: { id: string; model_type: ApplicationModelType }): string {
  if (app.model_type === "CONTENT") return `/applications/${app.id}/articles`;
  if (app.model_type === "CATALOG") return `/applications/${app.id}/items`;
  return `/applications/${app.id}`;
}

export const MODEL_LABEL: Record<ApplicationModelType, string> = {
  STRING: "UI strings",
  CONTENT: "Content",
  CATALOG: "Catalog",
};

/** Sidebar and badge label: a catalog shows its own item label, such as SKUs. */
export function appKindLabel(app: { model_type: ApplicationModelType; item_label?: string | null }): string {
  return app.model_type === "CATALOG" ? itemLabelPlural(app) : MODEL_LABEL[app.model_type];
}

export function formatBytes(size: number | null | undefined): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export type ItemImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; message: string }[];
  ignoredColumns: string[];
};

/**
 * Fixed locale and time zone, so the server render and the browser print the same text
 * (otherwise React reports a hydration mismatch). Same format as the article screens.
 */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
