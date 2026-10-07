import { createHash } from "node:crypto";
import { escapeIlike, getDb } from "@/lib/db/client";
import { applyQualityAction } from "@/lib/translation-quality/apply-action";
import type {
  BoilerplatePhrase,
  QualityAction,
  QualityActionStatus,
  QualityCategoryConfig,
  QualityFinding,
  QualityRunStatus,
  QualityRunSummary,
  QualityScore,
  QualityTargetField,
  TerminologyEntry,
  TranslationQualityResult,
} from "@/lib/translation-quality/types";

export function qualitySchemaMessage(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  if (/content_translation_version_id/i.test(message)) {
    return "Run migration 015_quality_run_version.sql from Setup.";
  }
  if (
    error?.code === "42P01" ||
    error?.code === "42883" ||
    error?.code === "42703" ||
    /quality_|terminology|boilerplate_phrases|commit_content_translation_quality/i.test(
      message
    )
  ) {
    return "Run migration 014_translation_quality.sql from Setup.";
  }
  return message || "Quality request failed.";
}

function weightOf(configuration: unknown): number {
  const value = (configuration ?? {}) as { weight?: unknown };
  const weight = Number(value.weight);
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function mapCategory(row: {
  id: string;
  code: string;
  name: string;
  description: string;
  category_type: "ai" | "rule";
  enabled: boolean;
  sort_order: number;
  provider: string | null;
  configuration: unknown;
}): QualityCategoryConfig {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? "",
    categoryType: row.category_type,
    enabled: row.enabled,
    sortOrder: row.sort_order ?? 0,
    provider: row.provider,
    weight: weightOf(row.configuration),
  };
}

export function mapTerminology(row: {
  id: string;
  term: string;
  definition: string;
  description: string;
  source_language: string;
  target_language: string;
  preferred_translation: string;
  forbidden_translations: string[] | null;
  category: string;
  context: string;
  example: string;
  is_active: boolean;
}): TerminologyEntry {
  return {
    id: row.id,
    term: row.term,
    definition: row.definition ?? "",
    description: row.description ?? "",
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    preferredTranslation: row.preferred_translation ?? "",
    forbiddenTranslations: row.forbidden_translations ?? [],
    category: row.category ?? "",
    context: row.context ?? "",
    example: row.example ?? "",
    isActive: row.is_active,
  };
}

function mapBoilerplate(row: {
  id: string;
  name: string;
  language: string;
  phrase: string;
  expected_usage: string;
  is_active: boolean;
}): BoilerplatePhrase {
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    phrase: row.phrase,
    expectedUsage: row.expected_usage ?? "",
    isActive: row.is_active,
  };
}

export async function listQualityCategories(enabledOnly = false) {
  const db = await getDb();
  let query = db.from("quality_categories").select("*").order("sort_order");
  if (enabledOnly) query = query.eq("enabled", true);
  const { data, error } = await query;
  if (error) throw new Error(qualitySchemaMessage(error));
  return (data ?? []).map((row) => mapCategory(row));
}

export async function listActiveTerminology() {
  const db = await getDb();
  const { data, error } = await db
    .from("terminology")
    .select("*")
    .eq("is_active", true)
    .order("term");
  if (error) throw new Error(qualitySchemaMessage(error));
  return (data ?? []).map((row) => mapTerminology(row));
}

export async function listTerminology() {
  const db = await getDb();
  const { data, error } = await db
    .from("terminology")
    .select("*")
    .order("source_language")
    .order("target_language")
    .order("term");
  if (error) throw new Error(qualitySchemaMessage(error));
  return (data ?? []).map((row) => mapTerminology(row));
}

export async function listTerminologyPage(input: {
  page: number;
  pageSize: number;
  search?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  active?: boolean;
}) {
  const db = await getDb();
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let query = db
    .from("terminology")
    .select("*", { count: "exact" })
    .order("source_language")
    .order("target_language")
    .order("term")
    .range(from, to);
  if (input.sourceLanguage) {
    query = query.ilike("source_language", escapeIlike(input.sourceLanguage));
  }
  if (input.targetLanguage) {
    query = query.ilike("target_language", escapeIlike(input.targetLanguage));
  }
  if (typeof input.active === "boolean") {
    query = query.eq("is_active", input.active);
  }
  const search = (input.search ?? "").trim().replace(/[,()"]/g, " ").replace(/\s+/g, " ").trim();
  if (search) {
    const term = escapeIlike(search);
    query = query.or(
      [
        `term.ilike.%${term}%`,
        `preferred_translation.ilike.%${term}%`,
        `definition.ilike.%${term}%`,
        `category.ilike.%${term}%`,
      ].join(",")
    );
  }
  const { data, error, count } = await query;
  if (error) throw new Error(qualitySchemaMessage(error));
  return {
    items: (data ?? []).map((row) => mapTerminology(row)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function listActiveBoilerplate() {
  const db = await getDb();
  const { data, error } = await db
    .from("boilerplate_phrases")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(qualitySchemaMessage(error));
  return (data ?? []).map((row) => mapBoilerplate(row));
}

export async function translationIdFor(contentId: string, languageCode: string) {
  const db = await getDb();
  const { data, error } = await db
    .from("content_translations")
    .select("id")
    .eq("content_id", contentId)
    .eq("language_code", languageCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}

export async function latestTranslationVersion(contentId: string, languageCode: string) {
  const db = await getDb();
  const { data: translation, error } = await db
    .from("content_translations")
    .select("id")
    .eq("content_id", contentId)
    .ilike("language_code", escapeIlike(languageCode))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!translation) return null;
  const { data: version, error: versionError } = await db
    .from("content_translation_versions")
    .select("id, version_number, translated_content, created_at")
    .eq("content_translation_id", translation.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) throw new Error(versionError.message);
  if (!version) return null;
  const content = (version.translated_content ?? {}) as {
    title?: string;
    summary?: string;
    body?: string;
  };
  return {
    translationId: translation.id as string,
    versionId: version.id as string,
    versionNumber: version.version_number as number,
    createdAt: version.created_at as string,
    title: content.title ?? "",
    summary: content.summary ?? "",
    body: content.body ?? "",
  };
}

export type VersionRunClaim = {
  id: string;
  status: string;
  createdAt: string;
  responseMetadata: Record<string, unknown> | null;
};

function mapVersionRun(row: {
  id: string;
  status: string;
  created_at: string;
  response_metadata: Record<string, unknown> | null;
}): VersionRunClaim {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    responseMetadata: row.response_metadata,
  };
}

export function versionRunUsesTokens(run: VersionRunClaim) {
  const usage = run.responseMetadata?.usage as
    | { promptTokens?: number; outputTokens?: number }
    | undefined;
  if ((usage?.promptTokens ?? 0) > 0 || (usage?.outputTokens ?? 0) > 0) return true;
  if (run.status === "completed") {
    const errors = run.responseMetadata?.categoryErrors;
    return !(Array.isArray(errors) && errors.length > 0);
  }
  if (run.status === "running") {
    const age = Date.now() - new Date(run.createdAt).getTime();
    return age < 15 * 60 * 1000;
  }
  return false;
}

export function draftTextHash(title: string, summary: string, body: string) {
  return createHash("sha256")
    .update(`${title.trim()}\n${summary.trim()}\n${body.trim()}`)
    .digest("hex");
}

export async function findVersionQualityRun(versionId: string) {
  const db = await getDb();
  const { data, error } = await db
    .from("quality_runs")
    .select("id, status, created_at, response_metadata")
    .eq("content_translation_version_id", versionId)
    .maybeSingle();
  if (error) throw new Error(qualitySchemaMessage(error));
  return data ? mapVersionRun(data) : null;
}

async function releaseVersionQualityRun(runId: string) {
  const db = await getDb();
  const { error } = await db.from("quality_runs").delete().eq("id", runId);
  if (error) throw new Error(qualitySchemaMessage(error));
}

export async function claimQualityRun(input: {
  contentId: string;
  contentTranslationId: string;
  versionId: string;
  versionCreatedAt: string;
  provider: string;
  model?: string;
  sourceLanguage: string;
  targetLanguage: string;
  requestMetadata: Record<string, unknown>;
}): Promise<{ id: string; createdAt: string; existing: boolean }> {
  const db = await getDb();
  const current = await findVersionQualityRun(input.versionId);
  if (current && versionRunUsesTokens(current)) {
    return { id: current.id, createdAt: current.createdAt, existing: true };
  }
  if (current) await releaseVersionQualityRun(current.id);

  const { data: legacy, error: legacyError } = await db
    .from("quality_runs")
    .select("id, status, created_at, response_metadata")
    .eq("content_id", input.contentId)
    .ilike("target_language", escapeIlike(input.targetLanguage))
    .is("content_translation_version_id", null)
    .filter("request_metadata->>draftTextHash", "is", null)
    .gte("created_at", input.versionCreatedAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (legacyError) throw new Error(qualitySchemaMessage(legacyError));
  if (legacy) {
    const mapped = mapVersionRun(legacy);
    if (versionRunUsesTokens(mapped)) {
      const { error: attachError } = await db
        .from("quality_runs")
        .update({ content_translation_version_id: input.versionId })
        .eq("id", mapped.id)
        .is("content_translation_version_id", null);
      if (attachError && attachError.code !== "23505") {
        throw new Error(qualitySchemaMessage(attachError));
      }
      return { id: mapped.id, createdAt: mapped.createdAt, existing: true };
    }
    await releaseVersionQualityRun(mapped.id);
  }

  const { data, error } = await db
    .from("quality_runs")
    .insert({
      content_id: input.contentId,
      content_translation_id: input.contentTranslationId,
      content_translation_version_id: input.versionId,
      provider: input.provider,
      model: input.model ?? null,
      source_language: input.sourceLanguage,
      target_language: input.targetLanguage,
      status: "running",
      request_metadata: input.requestMetadata,
    })
    .select("id, created_at")
    .single();
  if (error?.code === "23505") {
    const winner = await findVersionQualityRun(input.versionId);
    if (!winner) throw new Error(qualitySchemaMessage(error));
    return { id: winner.id, createdAt: winner.createdAt, existing: true };
  }
  if (error) throw new Error(qualitySchemaMessage(error));
  return { id: data.id as string, createdAt: data.created_at as string, existing: false };
}

async function discardUnattachedDraftRuns(contentId: string, targetLanguage: string) {
  const db = await getDb();
  const { error } = await db
    .from("quality_runs")
    .delete()
    .eq("content_id", contentId)
    .ilike("target_language", escapeIlike(targetLanguage))
    .is("content_translation_version_id", null)
    .not("request_metadata->>draftTextHash", "is", null);
  if (error) throw new Error(qualitySchemaMessage(error));
}

export async function insertDraftQualityRun(input: {
  contentId: string;
  contentTranslationId: string | null;
  provider: string;
  model?: string;
  sourceLanguage: string;
  targetLanguage: string;
  requestMetadata: Record<string, unknown>;
}): Promise<{ id: string; createdAt: string }> {
  await discardUnattachedDraftRuns(input.contentId, input.targetLanguage);
  const db = await getDb();
  const { data, error } = await db
    .from("quality_runs")
    .insert({
      content_id: input.contentId,
      content_translation_id: input.contentTranslationId,
      provider: input.provider,
      model: input.model ?? null,
      source_language: input.sourceLanguage,
      target_language: input.targetLanguage,
      status: "running",
      request_metadata: input.requestMetadata,
    })
    .select("id, created_at")
    .single();
  if (error) throw new Error(qualitySchemaMessage(error));
  return { id: data.id as string, createdAt: data.created_at as string };
}

async function versionFields(versionId: string) {
  const db = await getDb();
  const { data, error } = await db
    .from("content_translation_versions")
    .select("translated_content")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const content = (data.translated_content ?? {}) as {
    title?: string;
    summary?: string;
    body?: string;
  };
  return {
    title: content.title ?? "",
    summary: content.summary ?? "",
    body: content.body ?? "",
  };
}

/** Links a review to the version just saved when that version is the analyzed text, including accepted suggestions. */
export async function attachDraftQualityRun(input: {
  runId: string;
  contentId: string;
  languageCode: string;
  title: string;
  summary: string;
  body: string;
  acceptedActionIds?: string[];
}) {
  const version = await latestTranslationVersion(input.contentId, input.languageCode);
  if (!version) return false;
  const savedHash = draftTextHash(input.title, input.summary, input.body);
  if (draftTextHash(version.title, version.summary, version.body) !== savedHash) return false;

  const db = await getDb();
  const { data: run, error } = await db
    .from("quality_runs")
    .select("id, content_id, target_language, content_translation_version_id, request_metadata, status")
    .eq("id", input.runId)
    .maybeSingle();
  if (error) throw new Error(qualitySchemaMessage(error));
  if (!run || run.content_id !== input.contentId) return false;
  if (String(run.target_language).toLowerCase() !== input.languageCode.toLowerCase()) return false;
  if (run.status !== "completed" && run.status !== "failed") return false;
  if (run.content_translation_version_id === version.versionId) return true;

  const metadata = (run.request_metadata ?? {}) as {
    draftTextHash?: unknown;
    draftTitle?: unknown;
    draftSummary?: unknown;
    draftBody?: unknown;
  };
  const fromDraft =
    typeof metadata.draftTitle === "string" ||
    typeof metadata.draftSummary === "string" ||
    typeof metadata.draftBody === "string";
  const analyzed = fromDraft
    ? {
        title: typeof metadata.draftTitle === "string" ? metadata.draftTitle : "",
        summary: typeof metadata.draftSummary === "string" ? metadata.draftSummary : "",
        body: typeof metadata.draftBody === "string" ? metadata.draftBody : "",
      }
    : run.content_translation_version_id
      ? await versionFields(run.content_translation_version_id)
      : null;
  if (!analyzed) {
    if (metadata.draftTextHash !== savedHash) return false;
  } else {
    let expected = {
      title: analyzed.title,
      summary: analyzed.summary,
      body: analyzed.body,
      seo_title: "",
      seo_description: "",
    };
    for (const actionId of input.acceptedActionIds ?? []) {
      const row = await getQualityActionRow(actionId);
      if (row.runId !== input.runId) return false;
      try {
        expected = applyQualityAction(expected, row.action);
      } catch {
        return false;
      }
    }
    if (draftTextHash(expected.title, expected.summary, expected.body) !== savedHash) return false;
  }

  const existing = await findVersionQualityRun(version.versionId);
  if (existing && existing.id !== input.runId && versionRunUsesTokens(existing)) return false;
  if (existing && existing.id !== input.runId) await releaseVersionQualityRun(existing.id);

  const { error: updateError } = await db
    .from("quality_runs")
    .update({
      content_translation_id: version.translationId,
      content_translation_version_id: version.versionId,
    })
    .eq("id", input.runId);
  if (updateError?.code === "23505") return false;
  if (updateError) throw new Error(qualitySchemaMessage(updateError));
  return true;
}

export async function persistQualityDetails(input: {
  runId: string;
  categories: QualityCategoryConfig[];
  scores: QualityScore[];
  findings: QualityFinding[];
  actions: QualityAction[];
}) {
  const db = await getDb();
  const categoryIds = new Map(input.categories.map((category) => [category.code, category.id]));
  if (input.scores.length > 0) {
    const { error } = await db.from("quality_scores").insert(
      input.scores.map((score) => ({
        quality_run_id: input.runId,
        category_id: categoryIds.get(score.categoryCode) ?? null,
        category_code: score.categoryCode,
        score: score.score,
        severity: score.severity ?? null,
        summary: score.summary ?? "",
        error_message: score.error ?? null,
      }))
    );
    if (error) throw new Error(qualitySchemaMessage(error));
  }

  const { data: scoreRows, error: scoreError } = await db
    .from("quality_scores")
    .select("id, category_code")
    .eq("quality_run_id", input.runId);
  if (scoreError) throw new Error(qualitySchemaMessage(scoreError));
  const scoreIds = new Map(
    (scoreRows ?? []).map((row) => [row.category_code as string, row.id as string])
  );

  if (input.findings.length > 0) {
    const { error } = await db.from("quality_findings").insert(
      input.findings.map((finding) => ({
        id: finding.id,
        quality_run_id: input.runId,
        quality_score_id: scoreIds.get(finding.categoryCode) ?? null,
        category_code: finding.categoryCode,
        severity: finding.severity,
        title: finding.title,
        explanation: finding.explanation,
        source_text: finding.sourceText ?? null,
        translated_text: finding.translatedText ?? null,
        suggested_text: finding.suggestedText ?? null,
        target_field: finding.targetField ?? null,
        start_offset: finding.startOffset ?? null,
        end_offset: finding.endOffset ?? null,
      }))
    );
    if (error) throw new Error(qualitySchemaMessage(error));
  }

  if (input.actions.length > 0) {
    const { error } = await db.from("quality_actions").insert(
      input.actions.map((action) => ({
        id: action.id,
        quality_run_id: input.runId,
        finding_id: action.findingId,
        action_type: action.actionType,
        target_field: action.targetField,
        description: action.description,
        original_text: action.originalText ?? null,
        proposed_text: action.proposedText ?? null,
        start_offset: action.startOffset ?? null,
        end_offset: action.endOffset ?? null,
        status: "pending",
      }))
    );
    if (error) throw new Error(qualitySchemaMessage(error));
  }
}

export async function replaceRuleCheck(input: {
  runId: string;
  ruleCodes: string[];
  categories: QualityCategoryConfig[];
  scores: QualityScore[];
  findings: QualityFinding[];
  actions: QualityAction[];
  overallScore: number | null;
}) {
  const db = await getDb();
  const codes = [...new Set(input.ruleCodes)];
  if (codes.length > 0) {
    const { error: findingError } = await db
      .from("quality_findings")
      .delete()
      .eq("quality_run_id", input.runId)
      .in("category_code", codes);
    if (findingError) throw new Error(qualitySchemaMessage(findingError));
    const { error: scoreError } = await db
      .from("quality_scores")
      .delete()
      .eq("quality_run_id", input.runId)
      .in("category_code", codes);
    if (scoreError) throw new Error(qualitySchemaMessage(scoreError));
  }
  await persistQualityDetails({
    runId: input.runId,
    categories: input.categories,
    scores: input.scores,
    findings: input.findings,
    actions: input.actions,
  });
  const { error } = await db
    .from("quality_runs")
    .update({ overall_score: input.overallScore })
    .eq("id", input.runId);
  if (error) throw new Error(qualitySchemaMessage(error));
}

export async function finishQualityRun(input: {
  runId: string;
  status: QualityRunStatus;
  overallScore: number | null;
  responseMetadata: Record<string, unknown>;
  errorMessage?: string;
}) {
  const db = await getDb();
  const { error } = await db
    .from("quality_runs")
    .update({
      status: input.status,
      overall_score: input.overallScore,
      response_metadata: input.responseMetadata,
      error_message: input.errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.runId);
  if (error) throw new Error(qualitySchemaMessage(error));
}

type ScoreRow = {
  id: string;
  category_code: string;
  score: number | string | null;
  severity: QualityScore["severity"] | null;
  summary: string;
  error_message: string | null;
  category: {
    name: string;
    category_type: "ai" | "rule";
    sort_order: number;
  } | null;
};

type FindingRow = {
  id: string;
  category_code: string;
  severity: QualityFinding["severity"];
  title: string;
  explanation: string;
  source_text: string | null;
  translated_text: string | null;
  suggested_text: string | null;
  target_field: QualityTargetField | null;
  start_offset: number | null;
  end_offset: number | null;
};

type ActionRow = {
  id: string;
  finding_id: string;
  action_type: QualityAction["actionType"];
  description: string;
  original_text: string | null;
  proposed_text: string | null;
  target_field: QualityTargetField;
  start_offset: number | null;
  end_offset: number | null;
  status: QualityActionStatus;
};

function mapResult(run: {
  id: string;
  status: QualityRunStatus;
  overall_score: number | string | null;
  provider: string;
  model: string | null;
  response_metadata: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}, scores: ScoreRow[], findings: FindingRow[], actions: ActionRow[]): TranslationQualityResult {
  const metadata = run.response_metadata ?? {};
  return {
    runId: run.id,
    status: run.status,
    overallScore: asNumber(run.overall_score),
    scores: scores
      .map((score) => ({
        categoryCode: score.category_code,
        categoryName: score.category?.name ?? score.category_code,
        categoryType: score.category?.category_type ?? "ai",
        score: asNumber(score.score),
        severity: score.severity ?? undefined,
        summary: score.summary || undefined,
        error: score.error_message ?? undefined,
        sortOrder: score.category?.sort_order ?? 0,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    findings: findings.map((finding) => ({
      id: finding.id,
      categoryCode: finding.category_code,
      severity: finding.severity,
      title: finding.title,
      explanation: finding.explanation,
      sourceText: finding.source_text ?? undefined,
      translatedText: finding.translated_text ?? undefined,
      suggestedText: finding.suggested_text ?? undefined,
      targetField: finding.target_field ?? undefined,
      startOffset: finding.start_offset ?? undefined,
      endOffset: finding.end_offset ?? undefined,
    })),
    actions: actions.map((action) => ({
      id: action.id,
      findingId: action.finding_id,
      actionType: action.action_type,
      description: action.description,
      originalText: action.original_text ?? undefined,
      proposedText: action.proposed_text ?? undefined,
      targetField: action.target_field,
      startOffset: action.start_offset ?? undefined,
      endOffset: action.end_offset ?? undefined,
      status: action.status,
    })),
    metadata: {
      provider: run.provider,
      model: run.model ?? (typeof metadata.model === "string" ? metadata.model : undefined),
      promptVersion:
        typeof metadata.promptVersion === "string" ? metadata.promptVersion : undefined,
      durationMs: typeof metadata.durationMs === "number" ? metadata.durationMs : undefined,
      partial: metadata.partial === true,
      categoryErrors: Array.isArray(metadata.categoryErrors)
        ? (metadata.categoryErrors as { categoryCode: string; message: string }[])
        : undefined,
    },
    createdAt: run.created_at,
    completedAt: run.completed_at ?? undefined,
    persisted: true,
  };
}

export async function getQualityRunRecord(runId: string): Promise<TranslationQualityResult & {
  contentId: string;
}> {
  const db = await getDb();
  const { data: run, error } = await db
    .from("quality_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(qualitySchemaMessage(error));
  if (!run) throw new Error("Quality analysis was not found.");

  const [scores, findings, actions] = await Promise.all([
    db
      .from("quality_scores")
      .select("id, category_code, score, severity, summary, error_message, category:quality_categories(name, category_type, sort_order)")
      .eq("quality_run_id", runId),
    db.from("quality_findings").select("*").eq("quality_run_id", runId),
    db.from("quality_actions").select("*").eq("quality_run_id", runId),
  ]);
  if (scores.error) throw new Error(qualitySchemaMessage(scores.error));
  if (findings.error) throw new Error(qualitySchemaMessage(findings.error));
  if (actions.error) throw new Error(qualitySchemaMessage(actions.error));

  return {
    ...mapResult(
      run,
      (scores.data ?? []) as unknown as ScoreRow[],
      (findings.data ?? []) as FindingRow[],
      (actions.data ?? []) as ActionRow[]
    ),
    contentId: run.content_id as string,
  };
}

export async function listQualityRunSummaries(
  contentId: string,
  targetLanguage: string
): Promise<QualityRunSummary[]> {
  const db = await getDb();
  const { data, error } = await db
    .from("quality_runs")
    .select("id, provider, model, status, overall_score, source_language, target_language, created_at, completed_at, content_translation_version_id, request_metadata")
    .eq("content_id", contentId)
    .eq("target_language", targetLanguage)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(qualitySchemaMessage(error));
  return (data ?? []).flatMap((row) => {
    const versionId = (row.content_translation_version_id as string | null) ?? null;
    const draftHash = (row.request_metadata as { draftTextHash?: unknown } | null)?.draftTextHash;
    if (!versionId && typeof draftHash === "string") return [];
    return [{
      id: row.id as string,
      provider: row.provider as string,
      model: (row.model as string | null) ?? undefined,
      status: row.status as QualityRunStatus,
      overallScore: asNumber(row.overall_score),
      sourceLanguage: row.source_language as string,
      targetLanguage: row.target_language as string,
      createdAt: row.created_at as string,
      completedAt: (row.completed_at as string | null) ?? undefined,
      versionId: versionId ?? undefined,
    }];
  });
}

export async function getQualityActionRow(actionId: string) {
  const db = await getDb();
  const { data, error } = await db
    .from("quality_actions")
    .select("*, run:quality_runs(id, content_id, status)")
    .eq("id", actionId)
    .maybeSingle();
  if (error) throw new Error(qualitySchemaMessage(error));
  if (!data) throw new Error("Suggestion was not found.");
  const run = data.run as { id: string; content_id: string; status: string } | null;
  return {
    action: {
      id: data.id as string,
      findingId: data.finding_id as string,
      actionType: data.action_type as QualityAction["actionType"],
      description: (data.description as string) ?? "",
      originalText: (data.original_text as string | null) ?? undefined,
      proposedText: (data.proposed_text as string | null) ?? undefined,
      targetField: data.target_field as QualityTargetField,
      startOffset: (data.start_offset as number | null) ?? undefined,
      endOffset: (data.end_offset as number | null) ?? undefined,
      status: data.status as QualityActionStatus,
    } satisfies QualityAction,
    contentId: run?.content_id ?? "",
    runId: run?.id ?? "",
  };
}
