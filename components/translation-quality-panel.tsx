"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  analyzeTranslationQuality,
  getTranslationQualityRun,
  ignoreTranslationFinding,
  listQualitySettings,
  loadTranslationQuality,
  previewTranslationQuality,
  recheckTranslationRules,
} from "@/lib/actions/quality";
import { Badge, Button, Card } from "@/components/ui";
import { containsVisibleText } from "@/lib/translation-quality/apply-action";
import { htmlToText, readableQualityError, termHitContext } from "@/lib/translation-quality/text";
import type { SourceContentFields } from "@/lib/types";
import type {
  QualityAction,
  QualityCategoryConfig,
  QualityFinding,
  QualityRunSummary,
  QualityScore,
  TranslationQualityResult,
} from "@/lib/translation-quality/types";

function formatRunWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return `Today ${time}`;
  return `${date.toLocaleDateString()} ${time}`;
}

function scoreTone(score: QualityScore): "good" | "warn" | "bad" | "neutral" {
  if (score.score == null || score.error) return "bad";
  if (score.severity === "excellent" || score.severity === "good") return "good";
  if (score.severity === "warning") return "warn";
  return "bad";
}

function barClass(score: number | null) {
  if (score == null) return "bg-slate-300";
  if (score >= 75) return "bg-emerald-500";
  if (score >= 60) return "bg-yellow-400";
  return "bg-red-500";
}

function fallbackAction(finding: QualityFinding): QualityAction | null {
  if (!finding.targetField || !finding.translatedText || !finding.suggestedText) return null;
  if (finding.translatedText === finding.suggestedText) return null;
  return {
    id: finding.id,
    findingId: finding.id,
    actionType: "replace",
    description: finding.title,
    originalText: finding.translatedText,
    proposedText: finding.suggestedText,
    targetField: finding.targetField,
    status: "pending",
  };
}

function findingMark(severity: QualityFinding["severity"]) {
  if (severity === "critical" || severity === "error") {
    return { label: "Blocker", dot: "bg-red-600" };
  }
  if (severity === "warning") return { label: "Check", dot: "bg-amber-500" };
  return { label: "Note", dot: "bg-sky-500" };
}

function fieldText(draft: SourceContentFields, field: QualityFinding["targetField"]) {
  if (field === "title") return draft.title;
  if (field === "summary") return draft.summary;
  return draft.body;
}

function locateFinding(
  draft: SourceContentFields,
  finding: QualityFinding
): { field: QualityAction["targetField"]; hidden: boolean; inLink: boolean; snippet: string } | null {
  const needle = (finding.translatedText ?? "").trim();
  if (!needle) return null;
  const preferred = finding.targetField ? [finding.targetField] : [];
  const fields = [...preferred, "content", "summary", "title"] as const;
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field)) continue;
    seen.add(field);
    const raw = fieldText(draft, field);
    const plain = htmlToText(raw);
    if (
      !plain.toLowerCase().includes(needle.toLowerCase()) &&
      !raw.toLowerCase().includes(needle.toLowerCase()) &&
      !containsVisibleText(raw, needle)
    ) {
      continue;
    }
    const index = raw.toLowerCase().indexOf(needle.toLowerCase());
    if (index >= 0) {
      const place = termHitContext(raw, index, needle.length);
      return { field, ...place };
    }
    return { field, hidden: false, inLink: false, snippet: "" };
  }
  return null;
}

function EditTranslationLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--hub-border-strong)] bg-white px-3.5 text-sm font-semibold text-slate-800 shadow-sm hover:border-[var(--hub-accent)] hover:bg-[var(--hub-accent-soft)] hover:text-[var(--hub-accent)]"
    >
      Edit
    </Link>
  );
}

function fieldLabel(field: QualityAction["targetField"]) {
  if (field === "content") return "Body";
  if (field === "summary") return "Description";
  return "Title";
}

function ScoreGroup({
  title,
  scores,
}: {
  title: string;
  scores: QualityScore[];
}) {
  if (scores.length === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      <ul className="mt-2 divide-y divide-[var(--hub-border)]">
        {scores.map((score) => (
          <li key={score.categoryCode} className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">
                {score.categoryName}
              </span>
              {score.summary ? (
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                  {readableQualityError(score.summary)}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
              {score.score == null ? (
                <Badge tone="bad">Failed</Badge>
              ) : (
                <Badge tone={scoreTone(score)}>{score.score}</Badge>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TranslationQualityPanel({
  applicationId,
  contentId,
  languageCode,
  languageName,
  sourceLanguage,
  source,
  draft,
  savedAt,
  canReview,
  canApply = true,
  unsaved,
  showName = false,
  variant = "inline",
  languageChoices,
  onLanguageChange,
  saving = false,
  onSave,
  acceptedActionIds,
  ignoredActionIds,
  onLatestRunId,
  onAccept,
  onIgnore,
  onPreview,
  onShow,
  showEditLink = false,
  sessionOnly = false,
}: {
  applicationId: string;
  contentId: string;
  languageCode: string;
  languageName: string;
  sourceLanguage: string;
  source: SourceContentFields;
  draft: SourceContentFields;
  savedAt: string;
  canReview: boolean;
  /** Accept and ignore stay on the editor. The article page only shows the score. */
  canApply?: boolean;
  unsaved: boolean;
  /** Show the language name beside the score. Used on the article page. */
  showName?: boolean;
  /** Rail sits beside the article: score, bars, and findings. */
  variant?: "inline" | "rail";
  languageChoices?: { code: string; label: string }[];
  onLanguageChange?: (code: string) => void;
  saving?: boolean;
  onSave?: () => void;
  acceptedActionIds: string[];
  ignoredActionIds: string[];
  onLatestRunId: (runId: string | null) => void;
  onAccept: (action: QualityAction, stored?: boolean, quiet?: boolean) => void;
  onIgnore: (actionId: string, stored?: boolean) => void;
  /** Hover a finding to highlight that sentence in the article. */
  onPreview?: (target: { field: QualityAction["targetField"]; text: string } | null) => void;
  /** Jump to the highlighted sentence. Hover only highlights. */
  onShow?: (target: { field: QualityAction["targetField"]; text: string }) => void;
  /** Link to the editor. Hidden when this panel is already on the edit page. */
  showEditLink?: boolean;
  /** Score the text in memory. Used on the new-draft page before an article exists. */
  sessionOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const requestKey = sessionOnly
    ? `session:${languageCode}`
    : `${contentId}:${languageCode}:${savedAt}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState("");
  const [categories, setCategories] = useState<QualityCategoryConfig[]>([]);
  const [history, setHistory] = useState<QualityRunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TranslationQualityResult>>({});
  const [open, setOpen] = useState(false);
  const [canAnalyze, setCanAnalyze] = useState(false);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [checkedDraftKey, setCheckedDraftKey] = useState<string | null>(null);
  const onLatestRunIdRef = useRef(onLatestRunId);
  const previewRef = useRef<{
    key: string;
    languageCode: string;
    result: TranslationQualityResult;
  } | null>(null);
  const draftKey = `${draft.title}\n${draft.summary}\n${draft.body}`;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const pinnedPreview = useRef(false);
  const accepted = new Set(acceptedActionIds);
  const ignored = new Set(ignoredActionIds);
  const loading = loadedKey !== requestKey;
  const visibleError = errorKey === requestKey ? error : "";

  useEffect(() => {
    onLatestRunIdRef.current = onLatestRunId;
  }, [onLatestRunId]);

  const previewWatch = `${languageCode}\n${draftKey}`;
  useEffect(() => {
    const preview = previewRef.current;
    const watchedLanguage = previewWatch.slice(0, previewWatch.indexOf("\n"));
    const watchedDraft = previewWatch.slice(previewWatch.indexOf("\n") + 1);
    if (!preview || preview.languageCode !== watchedLanguage) return;
    if (preview.key !== watchedDraft) return;
    onLatestRunIdRef.current(preview.result.runId);
  }, [previewWatch]);

  useEffect(() => {
    if (sessionOnly) return;
    let cancelled = false;
    const key = requestKey;
    loadTranslationQuality({ contentId, languageCode })
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded.bundle) {
          setError(loaded.error || "Could not load quality review.");
          setErrorKey(key);
          setLoadedKey(key);
          return;
        }
        const bundle = loaded.bundle;
        setCategories(bundle.categories);
        setHistory(bundle.runs);
        setCanAnalyze(bundle.canAnalyze);
        setVersionNumber(bundle.versionNumber);
        const preview = previewRef.current;
        const keepPreview =
          preview &&
          preview.languageCode === languageCode &&
          preview.key === draftKeyRef.current;
        if (keepPreview && bundle.latest?.runId === preview.result.runId) {
          previewRef.current = null;
          setCheckedDraftKey(null);
          setResults({ [bundle.latest.runId]: bundle.latest });
          setSelectedId(bundle.latest.runId);
          onLatestRunIdRef.current(bundle.latest.runId);
        } else if (keepPreview) {
          setResults({
            [preview.result.runId]: preview.result,
            ...(bundle.latest ? { [bundle.latest.runId]: bundle.latest } : {}),
          });
          setSelectedId(preview.result.runId);
          onLatestRunIdRef.current(preview.result.runId);
        } else if (bundle.latest) {
          setResults({ [bundle.latest.runId]: bundle.latest });
          setSelectedId(bundle.latest.runId);
          onLatestRunIdRef.current(bundle.latest.runId);
        } else {
          setResults({});
          setSelectedId(null);
          onLatestRunIdRef.current(null);
          setOpen(false);
        }
        setError("");
        setErrorKey(key);
        setLoadedKey(key);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load quality review.");
        setErrorKey(key);
        setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [contentId, languageCode, requestKey, savedAt, sessionOnly]);

  useEffect(() => {
    if (!sessionOnly) return;
    let cancelled = false;
    const key = requestKey;
    listQualitySettings(applicationId)
      .then((settings) => {
        if (cancelled) return;
        setCategories(settings.categories);
        setCanAnalyze(true);
        setHistory([]);
        setError("");
        setErrorKey(key);
        setLoadedKey(key);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load quality review.");
        setErrorKey(key);
        setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, requestKey, sessionOnly]);

  const selected = loading || !selectedId ? undefined : results[selectedId];
  const latestId = history[0]?.id ?? null;
  const isLatest = Boolean(selected && selected.runId === latestId);
  const isDraftPreview = selected?.persisted === false;
  const aiScores = (selected?.scores ?? []).filter((score) => score.categoryType === "ai");
  const ruleScores = (selected?.scores ?? []).filter((score) => score.categoryType === "rule");
  const enabled = categories.filter((category) => category.enabled);

  function openRun(runId: string) {
    setSelectedId(runId);
    if (results[runId]) return;
    startTransition(async () => {
      try {
        const run = await getTranslationQualityRun(runId);
        setResults((current) => ({ ...current, [run.runId]: run }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open that analysis.");
      }
    });
  }

  function analyze() {
    setError("");
    startTransition(async () => {
      try {
        const loaded = sessionOnly
          ? await previewTranslationQuality({
              applicationId,
              sourceLanguage,
              targetLanguage: languageCode,
              sourceTitle: source.title,
              sourceSummary: source.summary,
              sourceContent: source.body,
              translatedTitle: draft.title,
              translatedSummary: draft.summary,
              translatedContent: draft.body,
            })
          : await analyzeTranslationQuality({
              applicationId,
              contentId,
              sourceLanguage,
              targetLanguage: languageCode,
              sourceTitle: source.title,
              sourceSummary: source.summary,
              sourceContent: source.body,
              translatedTitle: draft.title,
              translatedSummary: draft.summary,
              translatedContent: draft.body,
              acceptedActionIds,
            });
        if (!loaded.result) {
          setError(loaded.error || "Quality analysis failed. Please try again.");
          setErrorKey(requestKey);
          return;
        }
        const result = loaded.result;
        const analyzedKey = `${draft.title}\n${draft.summary}\n${draft.body}`;
        const replacedId = selectedId;
        if (result.persisted) {
          const summary: QualityRunSummary = {
            id: result.runId,
            provider: result.metadata.provider,
            model: result.metadata.model,
            status: result.status,
            overallScore: result.overallScore,
            sourceLanguage,
            targetLanguage: languageCode,
            createdAt: result.createdAt,
            completedAt: result.completedAt,
          };
          setHistory((current) => [
            summary,
            ...current.filter((item) => item.id !== result.runId && item.id !== replacedId),
          ]);
          setCanAnalyze(true);
          previewRef.current = null;
          setCheckedDraftKey(null);
          onLatestRunIdRef.current(result.runId);
        } else {
          previewRef.current = { key: analyzedKey, languageCode, result };
          setCheckedDraftKey(analyzedKey);
          onLatestRunIdRef.current(result.runId);
        }
        setResults((current) => ({ ...current, [result.runId]: result }));
        setSelectedId(result.runId);
        setOpen(true);
        if (result.status === "failed") {
          setError("Quality analysis failed. Please try again.");
          setErrorKey(requestKey);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Quality analysis failed. Please try again."
        );
        setErrorKey(requestKey);
        setOpen(true);
      }
    });
  }

  function ignoreFinding(findingId: string) {
    const runId = selected?.runId;
    if (!runId) return;
    if (sessionOnly) {
      onIgnore(findingId, false);
      setResults((current) => {
        const result = current[runId];
        if (!result) return current;
        const actions = result.actions.some((item) => item.findingId === findingId)
          ? result.actions.map((item) =>
              item.findingId === findingId ? { ...item, status: "ignored" as const } : item
            )
          : result.actions;
        return { ...current, [runId]: { ...result, actions } };
      });
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await ignoreTranslationFinding({ applicationId, runId, findingId });
        onIgnore(findingId, false);
        setResults((current) => {
          const result = current[runId];
          if (!result) return current;
          const actions = result.actions.some((item) => item.findingId === findingId)
            ? result.actions.map((item) =>
                item.findingId === findingId ? { ...item, status: "ignored" as const } : item
              )
            : result.actions;
          return { ...current, [runId]: { ...result, actions } };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not ignore that finding.");
        setErrorKey(requestKey);
      }
    });
  }

  function recheck() {
    setError("");
    startTransition(async () => {
      try {
        const loaded = await recheckTranslationRules({
          applicationId,
          contentId,
          sourceLanguage,
          targetLanguage: languageCode,
          sourceTitle: source.title,
          sourceSummary: source.summary,
          sourceContent: source.body,
        });
        if (!loaded.result) {
          setError(loaded.error || "Could not recheck wording.");
          setErrorKey(requestKey);
          return;
        }
        const result = loaded.result;
        setResults((current) => ({ ...current, [result.runId]: result }));
        setSelectedId(result.runId);
        setHistory((current) =>
          current.map((item) =>
            item.id === result.runId ? { ...item, overallScore: result.overallScore } : item
          )
        );
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not recheck wording.");
        setErrorKey(requestKey);
      }
    });
  }

  const visibleFindings = (selected?.findings ?? []).filter((finding) => {
    if (accepted.has(finding.id) || ignored.has(finding.id)) return false;
    const action = selected?.actions.find((item) => item.findingId === finding.id);
    if (!action) return true;
    if (accepted.has(action.id) || ignored.has(action.id)) return false;
    if (action.status !== "pending") return !isLatest && !isDraftPreview;
    return true;
  });
  const acceptItems = visibleFindings.flatMap((finding) => {
    if (!selected) return [];
    const storedAction = selected.actions.find((item) => item.findingId === finding.id);
    const action = storedAction ?? fallbackAction(finding);
    const place = locateFinding(draft, finding);
    const open =
      canApply &&
      canReview &&
      Boolean(action) &&
      (!action || action.status === "pending") &&
      !accepted.has(action?.id ?? finding.id) &&
      !ignored.has(action?.id ?? finding.id) &&
      Boolean(place && !place.hidden);
    if (!open || !action || !place) return [];
    return [{ action: { ...action, targetField: place.field }, stored: Boolean(storedAction) }];
  });
  function acceptAll() {
    const ordered = [...acceptItems].sort(
      (left, right) =>
        (right.action.originalText?.length ?? 0) - (left.action.originalText?.length ?? 0)
    );
    for (const item of ordered) onAccept(item.action, item.stored, true);
  }

  const versionLabel = versionNumber ? `v${versionNumber}` : "";
  const editHref = `/applications/${applicationId}/articles/${contentId}/edit?lang=${encodeURIComponent(languageCode)}`;
  const draftLocked = checkedDraftKey !== null && checkedDraftKey === draftKey;
  const showAnalyze = unsaved ? !draftLocked : canAnalyze && !draftLocked;
  const analyzeLabel = pending
    ? "Analyzing…"
    : unsaved || draftLocked
      ? "Analyze draft"
      : selected?.overallScore != null
        ? "Analyze again"
        : versionLabel
          ? `Analyze ${versionLabel}`
          : "Analyze";
  const scoreText =
    selected?.overallScore == null
      ? ""
      : selected.persisted === false
        ? `Draft ${selected.overallScore}`
        : `${versionLabel ? `${versionLabel} · ` : ""}${selected.overallScore}`;
  const rankedScores = [...(selected?.scores ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const failedCheck = rankedScores.find((score) => score.score == null && score.summary);
  const blockerCount = visibleFindings.filter(
    (finding) => finding.severity === "error" || finding.severity === "critical"
  ).length;
  const categoriesWithFindings = new Set(
    (selected?.findings ?? []).map((finding) => finding.categoryCode)
  );
  const openCategories = new Set(visibleFindings.map((finding) => finding.categoryCode));
  const summaryIsCurrent = (categoryCode: string) =>
    visibleFindings.length > 0 &&
    (!categoriesWithFindings.has(categoryCode) || openCategories.has(categoryCode));

  if (variant === "rail") {
    return (
      <Card className="p-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto">
        {languageChoices && languageChoices.length > 1 ? (
          <label className="mb-3 block text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Review
            <select
              className="mt-1 h-9 w-full rounded-lg border border-[var(--hub-border-strong)] bg-white px-2 text-sm font-medium text-slate-900 normal-case"
              value={languageCode}
              onChange={(event) => onLanguageChange?.(event.target.value)}
            >
              {languageChoices.map((choice) => (
                <option key={choice.code} value={choice.code}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <p className="text-5xl leading-none font-bold tabular-nums text-slate-950">
            {loading ? "…" : selected?.overallScore == null ? "—" : selected.overallScore}
          </p>
          <Badge tone={selected?.overallScore == null ? "neutral" : selected.overallScore >= 75 ? "good" : selected.overallScore >= 60 ? "warn" : "bad"}>
            {selected?.persisted === false ? "Draft" : "Review"}
          </Badge>
        </div>
        <p className="mt-3 text-sm font-medium text-slate-800">
          {loading
            ? "Loading the review…"
            : !selected
              ? "Not reviewed yet"
              : blockerCount === 0
                ? "No blockers in this review"
                : `${blockerCount} blocker${blockerCount === 1 ? "" : "s"} flagged in this review`}
        </p>
        {rankedScores
          .filter(
            (score) =>
              score.summary &&
              typeof score.score === "number" &&
              score.score < 100 &&
              summaryIsCurrent(score.categoryCode)
          )
          .map((score) => (
            <p key={score.categoryCode} className="mt-1 text-xs leading-relaxed text-slate-500">
              {score.categoryName}: {readableQualityError(score.summary ?? "")}
            </p>
          ))}
        {showAnalyze || draftLocked ? (
          <Button
            type="button"
            className="mt-3 w-full"
            variant="secondary"
            disabled={!showAnalyze || !canReview || pending || loading || saving}
            onClick={analyze}
          >
            {analyzeLabel}
          </Button>
        ) : null}
        {selected?.persisted && canReview && !unsaved ? (
          <>
            <Button
              type="button"
              className="mt-3 w-full"
              variant="secondary"
              disabled={pending || loading || saving}
              onClick={recheck}
            >
              {pending ? "Checking…" : "Recheck wording"}
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              Updates terminology and boilerplate. It does not call the model again.
            </p>
          </>
        ) : null}
        {onSave && unsaved ? (
          <Button type="button" className="mt-3 w-full" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        ) : null}
        {draftLocked ? (
          <p className="mt-2 text-xs text-slate-500">
            Change the text to analyze again. This draft check is not kept in history.
          </p>
        ) : null}
        {visibleError ? <p className="mt-2 text-sm text-red-700">{visibleError}</p> : null}
        {selected ? (
          <>
            <h3 className="mt-5 text-[11px] font-bold tracking-[0.14em] text-slate-500 uppercase">
              Dimensions
            </h3>
            <ul className="mt-3 space-y-2.5">
              {rankedScores.map((score) => (
                <li key={score.categoryCode} className="grid grid-cols-[7.25rem_1fr_1.75rem] items-center gap-2">
                  <span
                    className="truncate text-sm text-slate-800"
                    title={
                      score.summary && summaryIsCurrent(score.categoryCode)
                        ? readableQualityError(score.summary)
                        : score.categoryName
                    }
                  >
                    {score.categoryName}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className={`block h-full rounded-full ${barClass(score.score)}`}
                      style={{ width: `${score.score ?? 0}%` }}
                    />
                  </span>
                  <span className="text-right text-sm font-medium tabular-nums text-slate-800">
                    {score.score ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
            {failedCheck?.summary ? (
              <p className="mt-3 text-xs leading-relaxed text-red-700">
                {readableQualityError(failedCheck.summary)}
              </p>
            ) : null}
            <h3 className="mt-5 text-[11px] font-bold tracking-[0.14em] text-slate-500 uppercase">
              Findings {visibleFindings.length}
            </h3>
            {acceptItems.length > 1 ? (
              <Button type="button" className="mt-2 w-full" onClick={acceptAll}>
                Accept all
              </Button>
            ) : null}
            {visibleFindings.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No open findings.</p>
            ) : (
              <ul className="mt-1">
                {visibleFindings.map((finding) => {
                  const storedAction = selected.actions.find((item) => item.findingId === finding.id);
                  const action = storedAction ?? fallbackAction(finding);
                  const place = locateFinding(draft, finding);
                  const mark = findingMark(finding.severity);
                  const pending =
                    canApply &&
                    canReview &&
                    (!action || action.status === "pending") &&
                    !accepted.has(action?.id ?? finding.id) &&
                    !ignored.has(action?.id ?? finding.id);
                  const canAct = Boolean(place && !place.hidden) && pending && Boolean(action);
                  return (
                    <li
                      key={finding.id}
                      className="border-t border-[var(--hub-border)] py-3"
                      onMouseEnter={() => {
                        if (!onPreview || !place || place.hidden || !finding.translatedText) return;
                        pinnedPreview.current = false;
                        onPreview({ field: place.field, text: finding.translatedText });
                      }}
                      onMouseLeave={() => {
                        if (pinnedPreview.current) return;
                        onPreview?.(null);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-800 uppercase">
                          <span className={`h-2 w-2 rounded-full ${mark.dot}`} />
                          {mark.label}
                        </span>
                        <span className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                          {finding.categoryCode}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold text-slate-950">{finding.title}</p>
                      {finding.explanation ? (
                        <p className="mt-1 text-sm leading-relaxed text-slate-600">{finding.explanation}</p>
                      ) : null}
                      {finding.translatedText ? (
                        <p className="mt-2 text-xs leading-relaxed text-slate-700">
                          <span className="font-semibold text-slate-500">In this text: </span>
                          {finding.translatedText}
                        </p>
                      ) : null}
                      {finding.translatedText && finding.suggestedText && !place?.hidden ? (
                        <p className="mt-1 text-xs leading-relaxed text-slate-700">
                          <span className="font-semibold text-slate-500">Suggested: </span>
                          {finding.suggestedText}
                        </p>
                      ) : null}
                      {place?.hidden && place.snippet ? (
                        <p className="mt-2 text-xs leading-relaxed text-slate-600">
                          <span className="font-semibold text-slate-500">
                            {place.inLink ? "Inside a link: " : "Inside formatting: "}
                          </span>
                          {place.snippet}
                          {" This is not article wording, so Accept leaves it unchanged."}
                        </p>
                      ) : !place && finding.translatedText ? (
                        <p className="mt-2 text-xs leading-relaxed text-slate-500">
                          This wording is no longer in the translation, so it can’t be highlighted or accepted.
                        </p>
                      ) : null}
                      {canAct && action && place ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {onShow && finding.translatedText ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                pinnedPreview.current = true;
                                onShow({ field: place.field, text: finding.translatedText! });
                              }}
                            >
                              Show
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            onClick={() => onAccept({ ...action, targetField: place.field }, Boolean(storedAction))}
                          >
                            Accept
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => ignoreFinding(finding.id)}>Ignore</Button>
                          {showEditLink && canReview ? <EditTranslationLink href={editHref} /> : null}
                        </div>
                      ) : pending && canReview ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => ignoreFinding(finding.id)}
                          >
                            Ignore
                          </Button>
                          {showEditLink ? <EditTranslationLink href={editHref} /> : null}
                        </div>
                      ) : showEditLink && canReview ? (
                        <div className="mt-2">
                          <EditTranslationLink href={editHref} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {showName ? (
          <span className="text-sm font-semibold text-slate-900">{languageName}</span>
        ) : null}
        {scoreText ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg border border-[var(--hub-border-strong)] bg-white px-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:border-[var(--hub-accent)]"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Score {scoreText}
          </button>
        ) : null}
        {showAnalyze || draftLocked ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!showAnalyze || !canReview || pending || loading}
            onClick={analyze}
          >
            {analyzeLabel}
          </Button>
        ) : !scoreText ? (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg border border-[var(--hub-border)] bg-white px-2.5 text-sm text-slate-600"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {loading ? "Score…" : "No score"}
          </button>
        ) : null}
      </div>
      {draftLocked ? (
        <p className="mt-1 text-xs text-slate-500">
          Change the text to analyze again. This draft check is not kept in history.
        </p>
      ) : null}

      {visibleError ? <p className="mt-1 text-sm text-red-700">{visibleError}</p> : null}
      {open ? (
      <Card className="mt-3 space-y-4 p-4">
      {loading ? <p className="text-sm text-slate-500">Loading review…</p> : null}

      {!selected && !loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["ai", "rule"] as const).map((type) => {
            const group = enabled.filter((category) => category.categoryType === type);
            if (group.length === 0) return null;
            return (
              <section key={type}>
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {type === "ai" ? "AI" : "Rules"}
                </h3>
                <ul className="mt-2 space-y-2">
                  {group.map((category) => (
                    <li key={category.code}>
                      <span className="block text-sm font-medium text-slate-900">
                        {category.name}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                        {category.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div className="space-y-4">
          {selected.persisted === false ? (
            <p className="text-sm text-slate-500">
              This check is for the text you are editing. Save the translation when you are satisfied. It is not added to history.
            </p>
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Overall score
              </p>
              <p className="text-3xl font-bold tabular-nums text-slate-900">
                {selected.overallScore == null ? "—" : selected.overallScore}
              </p>
            </div>
            <p className="text-xs text-slate-500">
              {selected.metadata.provider}
              {selected.metadata.model ? ` · ${selected.metadata.model}` : ""}
              {selected.createdAt ? ` · ${formatRunWhen(selected.createdAt)}` : ""}
            </p>
          </div>
          {selected.metadata.partial ? (
            <p className="text-sm text-amber-800">
              Some categories failed. The scores below are the ones that completed.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <ScoreGroup title="AI" scores={aiScores} />
            <ScoreGroup title="Rules" scores={ruleScores} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Issues and suggestions</h3>
            {acceptItems.length > 1 ? (
              <Button type="button" className="mt-2" variant="secondary" onClick={acceptAll}>
                Accept all
              </Button>
            ) : null}
            {unsaved && (accepted.size > 0 || ignored.size > 0) ? (
              <p className="mt-1 text-xs font-medium text-amber-800">
                Unsaved changes. Accepted suggestions stay in the editor until you save.
                Leaving without saving keeps the article unchanged, and these suggestions
                can be reviewed again.
              </p>
            ) : null}
            {visibleFindings.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No open suggestions in this analysis.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {visibleFindings.map((finding) => {
                  const action = selected.actions.find((item) => item.findingId === finding.id);
                  const place = locateFinding(draft, finding);
                  const pending =
                    (isDraftPreview || isLatest) &&
                    canApply &&
                    canReview &&
                    (!action || action.status === "pending") &&
                    !accepted.has(action?.id ?? finding.id) &&
                    !ignored.has(action?.id ?? finding.id);
                  const canAct = Boolean(place && !place.hidden) && pending && Boolean(action);
                  return (
                    <li
                      key={finding.id}
                      className="rounded-lg border border-[var(--hub-border)] bg-slate-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            finding.severity === "info"
                              ? "info"
                              : finding.severity === "warning"
                                ? "warn"
                                : "bad"
                          }
                        >
                          {finding.severity}
                        </Badge>
                        <span className="text-sm font-semibold text-slate-900">{finding.title}</span>
                        {action ? (
                          <span className="text-xs text-slate-500">{fieldLabel(action.targetField)}</span>
                        ) : null}
                        {action && action.status !== "pending" ? (
                          <Badge tone={action.status === "applied" ? "good" : "neutral"}>
                            {action.status}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-slate-700">
                        {finding.explanation}
                      </p>
                      {finding.translatedText || finding.suggestedText ? (
                        <p className="mt-2 text-sm text-slate-900">
                          {finding.translatedText ? (
                            <span className="rounded bg-white px-1.5 py-0.5 line-through decoration-red-700">
                              {finding.translatedText}
                            </span>
                          ) : null}
                          {finding.translatedText && finding.suggestedText && !place?.hidden ? " → " : null}
                          {finding.translatedText && finding.suggestedText && !place?.hidden ? (
                            <span className="rounded bg-white px-1.5 py-0.5 font-medium">
                              {finding.suggestedText}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {place?.hidden && place.snippet ? (
                        <p className="mt-2 text-xs leading-relaxed text-slate-600">
                          <span className="font-semibold text-slate-500">
                            {place.inLink ? "Inside a link: " : "Inside formatting: "}
                          </span>
                          {place.snippet}
                          {" This is not article wording, so Accept leaves it unchanged."}
                        </p>
                      ) : !place && finding.translatedText ? (
                        <p className="mt-2 text-xs leading-relaxed text-slate-500">
                          This wording is no longer in the translation, so it can’t be highlighted or accepted.
                        </p>
                      ) : null}
                      {canAct && action && place ? (
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            onClick={() => onAccept({ ...action, targetField: place.field })}
                          >
                            Accept
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => ignoreFinding(finding.id)}>
                            Ignore
                          </Button>
                        </div>
                      ) : pending && canReview ? (
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => ignoreFinding(finding.id)}
                          >
                            Ignore
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {history.length > 0 && !loading ? (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Analysis history</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {history.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className={`rounded-lg border px-3 py-1.5 text-left text-xs ${
                    run.id === selectedId
                      ? "border-[var(--diy-red)] bg-[var(--diy-red-soft)] text-slate-900"
                      : "border-[var(--hub-border)] bg-white text-slate-600"
                  }`}
                  onClick={() => openRun(run.id)}
                >
                  <span className="block font-semibold">{formatRunWhen(run.createdAt)}</span>
                  <span className="block">
                    {run.overallScore == null ? run.status : `Score ${run.overallScore}`}
                    {run.model ? ` · ${run.model}` : ` · ${run.provider}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
      ) : null}
    </div>
  );
}
