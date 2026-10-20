import { getDb } from "@/lib/db/client";
import { effectiveToneCode, tonePrompt, type TonePrompt } from "@/lib/tones";
import type { ToneProfile } from "@/lib/types";

/** True when the error means migration 034 has not been run. */
export function toneSchemaMissing(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204") return true;
  return /tone_profiles|default_tone|\btone\b/i.test(error.message ?? "") &&
    /does not exist|schema cache|Could not find/i.test(error.message ?? "");
}

/**
 * The active tone an article translates with: its own tone, else its type's default.
 * Null when no tone applies. Undefined when migration 034 has not been run, so callers
 * leave the tone columns alone.
 */
export async function resolveArticleTone(input: {
  applicationId: string;
  contentType: string;
  /** The article's own choice. Undefined reads it from contentId. */
  tone?: string | null;
  contentId?: string;
}): Promise<TonePrompt | null | undefined> {
  const db = await getDb();
  let articleTone = input.tone;
  if (articleTone === undefined && input.contentId) {
    const { data, error } = await db
      .from("content")
      .select("tone")
      .eq("id", input.contentId)
      .maybeSingle();
    if (error) {
      if (toneSchemaMissing(error)) return undefined;
      throw new Error(error.message);
    }
    articleTone = (data?.tone as string | null | undefined) ?? null;
  }
  const { data: type, error: typeError } = await db
    .from("content_types")
    .select("default_tone")
    .eq("application_id", input.applicationId)
    .eq("code", input.contentType)
    .maybeSingle();
  if (typeError) {
    if (toneSchemaMissing(typeError)) return undefined;
    throw new Error(typeError.message);
  }
  const code = effectiveToneCode(articleTone, type as { default_tone?: string | null } | null);
  if (!code) return null;
  const { data: tone, error: toneError } = await db
    .from("tone_profiles")
    .select("*")
    .eq("application_id", input.applicationId)
    .eq("code", code)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (toneError) {
    if (toneSchemaMissing(toneError)) return undefined;
    throw new Error(toneError.message);
  }
  return tone ? tonePrompt(tone as ToneProfile) : null;
}

/** Tone columns for a machine translation row. Empty before migration 034. */
export function toneColumns(tone: TonePrompt | null | undefined) {
  if (tone === undefined) return undefined;
  return { tone: tone?.code ?? null, adapted: Boolean(tone?.allowAdaptation) };
}
