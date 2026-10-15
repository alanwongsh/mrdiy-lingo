import { getDb } from "@/lib/db/client";
import {
  REVIEW_EMAIL_KIND,
  REVIEW_TEMPLATE_FIELDS,
  type ReviewTemplateField,
} from "@/lib/notifications/review-template";

export const EMAIL_TEMPLATE_MIGRATION = "Run migration 029_email_templates.sql first.";

export function isMissingEmailTemplates(error: { code?: string }): boolean {
  // Table or (after an older draft of 029) a column is missing.
  return ["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code ?? "");
}

export type SavedReviewTemplate = Partial<Record<ReviewTemplateField, string | null>> & {
  updated_at?: string | null;
};

/** Saved review wording, null when nothing is saved. Throws when the table is missing. */
export async function loadSavedReviewTemplate(): Promise<SavedReviewTemplate | null> {
  const db = await getDb();
  const { data, error } = await db
    .from("email_templates")
    .select([...REVIEW_TEMPLATE_FIELDS.map((field) => field.key), "updated_at"].join(", "))
    .eq("kind", REVIEW_EMAIL_KIND)
    .maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return (data as SavedReviewTemplate | null) ?? null;
}
