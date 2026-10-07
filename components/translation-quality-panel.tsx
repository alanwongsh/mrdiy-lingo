"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  analyzeTranslationQuality,
  getTranslationQualityRun,
  loadTranslationQuality,
} from "@/lib/actions/quality";
import { Badge, Button, Card } from "@/components/ui";
import type { SourceContentFields } from "@/lib/types";
import type {
  QualityAction,
  QualityCategoryConfig,
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
                  {score.summary}
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
  acceptedActionIds,
  ignoredActionIds,
  onLatestRunId,
  onAccept,
  onIgnore,
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
  acceptedActionIds: string[];
  ignoredActionIds: string[];
  onLatestRunId: (runId: string | null) => void;
  onAccept: (action: QualityAction) => void;
  onIgnore: (actionId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const requestKey = `${contentId}:${languageCode}:${savedAt}`;
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
  const previewRef = useRef<{ key: string; result: TranslationQualityResult } | null>(null);
  const draftKey = `${draft.title}\n${draft.summary}\n${draft.body}`;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const accepted = new Set(acceptedActionIds);
  const ignored = new Set(ignoredActionIds);
  const loading = loadedKey !== requestKey;
  const visibleError = errorKey === requestKey ? error : "";

  useEffect(() => {
    onLatestRunIdRef.current = onLatestRunId;
  }, [onLatestRunId]);

  useEffect(() => {
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
        const keepPreview = preview && preview.key === draftKeyRef.current;
        if (keepPreview) {
          setResults({
            [preview.result.runId]: preview.result,
            ...(bundle.latest ? { [bundle.latest.runId]: bundle.latest } : {}),
          });
          setSelectedId(preview.result.runId);
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
  }, [contentId, languageCode, requestKey, savedAt]);

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
        const loaded = await analyzeTranslationQuality({
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
        });
        if (!loaded.result) {
          setError(loaded.error || "Quality analysis failed. Please try again.");
          setErrorKey(requestKey);
          return;
        }
        const result = loaded.result;
        const analyzedKey = `${draft.title}\n${draft.summary}\n${draft.body}`;
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
          setHistory((current) => [summary, ...current.filter((item) => item.id !== result.runId)]);
          setCanAnalyze(false);
          previewRef.current = null;
          setCheckedDraftKey(null);
          onLatestRunIdRef.current(result.runId);
        } else {
          previewRef.current = { key: analyzedKey, result };
          setCheckedDraftKey(analyzedKey);
          onLatestRunIdRef.current(null);
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

  const visibleFindings = (selected?.findings ?? []).filter((finding) => {
    const action = selected?.actions.find((item) => item.findingId === finding.id);
    if (!action) return true;
    if (action.status !== "pending") return !isLatest;
    if (!isLatest) return true;
    return !accepted.has(action.id) && !ignored.has(action.id);
  });

  const versionLabel = versionNumber ? `v${versionNumber}` : "";
  const draftLocked = checkedDraftKey !== null && checkedDraftKey === draftKey;
  const showAnalyze = unsaved ? !draftLocked : canAnalyze && !draftLocked;
  const scoreText =
    selected?.overallScore == null
      ? ""
      : selected.persisted === false
        ? `Draft ${selected.overallScore}`
        : `${versionLabel ? `${versionLabel} · ` : ""}${selected.overallScore}`;

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
            {pending ? "Analyzing…" : unsaved || draftLocked ? "Analyze draft" : versionLabel ? `Analyze ${versionLabel}` : "Analyze"}
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
                  const canAct =
                    (isDraftPreview || isLatest) &&
                    canApply &&
                    canReview &&
                    action?.status === "pending" &&
                    !accepted.has(action.id) &&
                    !ignored.has(action.id);
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
                          {finding.translatedText && finding.suggestedText ? " → " : null}
                          {finding.suggestedText ? (
                            <span className="rounded bg-white px-1.5 py-0.5 font-medium">
                              {finding.suggestedText}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {canAct && action ? (
                        <div className="mt-3 flex gap-2">
                          <Button type="button" onClick={() => onAccept(action)}>
                            Accept
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => onIgnore(action.id)}>
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
