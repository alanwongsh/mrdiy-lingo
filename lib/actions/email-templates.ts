"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { UserFacingError } from "@/lib/errors";
import {
  DEFAULT_REVIEW_TEMPLATE,
  REVIEW_EMAIL_KIND,
  REVIEW_TEMPLATE_FIELDS,
  unknownVariables,
  type ReviewTemplate,
} from "@/lib/notifications/review-template";
import {
  EMAIL_TEMPLATE_MIGRATION,
  isMissingEmailTemplates,
  loadSavedReviewTemplate,
  type SavedReviewTemplate,
} from "@/lib/notifications/template-store";

export async function getReviewEmailTemplate(): Promise<SavedReviewTemplate | null> {
  await requireSuperadmin();
  try {
    return await loadSavedReviewTemplate();
  } catch (error) {
    if (isMissingEmailTemplates(error as { code?: string })) {
      throw new UserFacingError(EMAIL_TEMPLATE_MIGRATION);
    }
    throw error;
  }
}

/** Saves the review wording. A blank field falls back to the built-in default. */
export async function saveReviewEmailTemplate(input: ReviewTemplate): Promise<void> {
  const user = await requireSuperadmin();
  const row: Record<string, string | null> = {};
  for (const { key, label, maxLength } of REVIEW_TEMPLATE_FIELDS) {
    const value = String(input[key] ?? "").trim();
    if (value.length > maxLength) {
      throw new UserFacingError(`${label} is longer than ${maxLength.toLocaleString()} characters.`);
    }
    const unknown = unknownVariables(value);
    if (unknown.length > 0) {
      throw new UserFacingError(
        `${label} uses an unknown variable: ${unknown.map((name) => `{{${name}}}`).join(", ")}.`
      );
    }
    // Store only changes, so later updates to the default still reach this field.
    row[key] = value && value !== DEFAULT_REVIEW_TEMPLATE[key].trim() ? value : null;
  }

  const db = await getDb();
  const { error } = await db
    .from("email_templates")
    .upsert({ kind: REVIEW_EMAIL_KIND, ...row, updated_by: user.id }, { onConflict: "kind" });
  if (error) {
    if (isMissingEmailTemplates(error)) throw new UserFacingError(EMAIL_TEMPLATE_MIGRATION);
    throw new Error(error.message);
  }
  revalidatePath("/email-templates");
}
