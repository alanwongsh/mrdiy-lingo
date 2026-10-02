"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  autoTranslateArticleLanguages,
  deleteContentTranslationVersion,
  listContentTranslationVersions,
  saveManualContentTranslation,
  setContentTranslationStatus,
  updateArticle,
} from "@/lib/actions/press";
import type {
  Content,
  ContentLifecycleStatus,
  ContentTranslation,
  ContentTranslationVersion,
  ContentType,
  Language,
  SourceContentFields,
  TranslationStatus,
} from "@/lib/types";
import { emptySourceContent } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  statusTone,
  textareaClass,
} from "@/components/ui";
import {
  BatchTranslateButton,
  LanguageMultiSelect,
} from "@/components/language-multi-select";
import { ArticleVersionPanel } from "@/components/version-panel";
import { DeleteArticleButton } from "@/components/delete-article-button";
import { HtmlEditor, type HtmlEditorHandle } from "@/components/html-editor";

type ArticleWithTranslations = Content & {
  translations: ContentTranslation[];
};

function fieldsFromTranslation(
  t?: ContentTranslation | null
): SourceContentFields {
  if (!t) return emptySourceContent();
  return {
    title: t.title,
    summary: t.summary,
    body: t.body,
    seo_title: t.seo_title,
    seo_description: t.seo_description,
  };
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ArticleEditor({
  applicationId,
  article,
  languages,
}: {
  applicationId: string;
  article: ArticleWithTranslations;
  languages: Language[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLabel, setTranslatingLabel] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [status, setStatus] = useState(article.status);
  const [contentType, setContentType] = useState(article.content_type);
  const [slug, setSlug] = useState(article.slug ?? "");
  const [scheduledPublishAt, setScheduledPublishAt] = useState(
    toLocalInput(article.scheduled_publish_at)
  );
  const [source, setSource] = useState(article.source_content);
  const [sourceLanguage, setSourceLanguage] = useState(article.source_language);
  const [targetLanguages, setTargetLanguages] = useState<string[]>(
    article.target_languages ?? []
  );
  const allTargets = useMemo(
    () => languages.filter((l) => l.code !== sourceLanguage),
    [languages, sourceLanguage]
  );
  const targets = useMemo(() => {
    const allowed = new Set(targetLanguages);
    const scoped = allTargets.filter((l) => allowed.has(l.code));
    return scoped.length > 0 ? scoped : allTargets;
  }, [allTargets, targetLanguages]);
  const [targetLang, setTargetLang] = useState(
    () =>
      (article.target_languages ?? [])[0] ??
      languages.find((l) => l.code !== article.source_language)?.code ??
      "ms"
  );
  const [selected, setSelected] = useState<string[]>(() =>
    (article.target_languages?.length
      ? article.target_languages
      : []
    ).slice(0, 1)
  );
  const [draft, setDraft] = useState<SourceContentFields>(() => {
    const initialLang =
      (article.target_languages ?? [])[0] ??
      languages.find((l) => l.code !== article.source_language)?.code ??
      "ms";
    return fieldsFromTranslation(
      article.translations.find((tr) => tr.language_code === initialLang)
    );
  });
  const [bodyEpoch, setBodyEpoch] = useState(0);
  const [versions, setVersions] = useState<ContentTranslationVersion[]>([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const sourceBodyRef = useRef<HtmlEditorHandle>(null);

  const sourceLang = languages.find((l) => l.code === sourceLanguage);
  const targetMeta = languages.find((l) => l.code === targetLang);
  const targetTranslation = article.translations.find(
    (tr) => tr.language_code === targetLang
  );
  const langStatus: TranslationStatus =
    targetTranslation?.status ?? "MISSING";
  const savedFields = fieldsFromTranslation(targetTranslation);
  const isDirty =
    draft.title !== savedFields.title ||
    draft.summary !== savedFields.summary ||
    draft.body !== savedFields.body;
  const hasSavedContent = Boolean(
    targetTranslation &&
      (savedFields.title || savedFields.summary || savedFields.body)
  );

  const statuses = useMemo(
    () =>
      targets.map((l) => ({
        code: l.code,
        status:
          article.translations.find((t) => t.language_code === l.code)
            ?.status ?? ("MISSING" as TranslationStatus),
      })),
    [targets, article.translations]
  );

  useEffect(() => {
    setStatus(article.status);
    setContentType(article.content_type);
    setSlug(article.slug ?? "");
    setScheduledPublishAt(toLocalInput(article.scheduled_publish_at));
    setSource(article.source_content);
    setSourceLanguage(article.source_language);
    setTargetLanguages(article.target_languages ?? []);
    if (
      article.target_languages?.length &&
      !article.target_languages.includes(targetLang)
    ) {
      setTargetLang(article.target_languages[0]);
    }
  }, [article]);

  useEffect(() => {
    setTargetLanguages((prev) => {
      const next = prev.filter((code) => code !== sourceLanguage);
      return next.length === prev.length ? prev : next;
    });
    setSelected((prev) => {
      const next = prev.filter((code) => code !== sourceLanguage);
      return next.length === prev.length ? prev : next;
    });
    setTargetLang((current) => {
      if (current !== sourceLanguage) return current;
      return (
        allTargets.find((l) => l.code !== sourceLanguage)?.code ?? current
      );
    });
  }, [sourceLanguage, allTargets]);

  useEffect(() => {
    setDraft(fieldsFromTranslation(targetTranslation));
    setBodyEpoch((n) => n + 1);
    setShowHistory(false);
    setVersions([]);
    setHistoryError("");
  }, [targetLang, targetTranslation?.id, targetTranslation?.updated_at]);

  function loadHistory() {
    setShowHistory(true);
    setHistoryError("");
    setHistoryLoading(true);
    setVersions([]);

    startTransition(async () => {
      try {
        if (!targetTranslation?.id) {
          setVersions([]);
          return;
        }
        setVersions(await listContentTranslationVersions(targetTranslation.id));
      } catch (err) {
        setHistoryError(
          err instanceof Error ? err.message : "Failed to load history"
        );
      } finally {
        setHistoryLoading(false);
      }
    });
  }

  function runBatchTranslate() {
    if (selected.length === 0) return;
    setError("");
    setIsTranslating(true);
    setTranslatingLabel(
      selected
        .map((c) => languages.find((l) => l.code === c)?.name ?? c)
        .join(", ")
    );
    // Prefer TipTap's live HTML — React state can be emptied by editor sync bugs.
    const liveBody =
      sourceBodyRef.current?.getHTML()?.trim() ||
      source.body.trim() ||
      article.source_content.body;
    const sourceFields: SourceContentFields = {
      title: source.title.trim() || article.source_content.title || article.title,
      summary: source.summary.trim() || article.source_content.summary,
      body: liveBody,
      seo_title:
        source.seo_title.trim() ||
        source.title.trim() ||
        article.source_content.seo_title ||
        article.title,
      seo_description:
        source.seo_description.trim() ||
        source.summary.trim() ||
        article.source_content.seo_description,
    };
    if (liveBody && liveBody !== source.body) {
      setSource((s) => ({ ...s, body: liveBody }));
    }
    startTransition(async () => {
      try {
        const results = await autoTranslateArticleLanguages({
          contentId: article.id,
          targetLanguages: selected.filter((code) => code !== sourceLanguage),
          applicationId,
          sourceLanguage,
          sourceFields,
        });
        const forCurrent = results.find((r) => r.language_code === targetLang);
        if (forCurrent) {
          setDraft(fieldsFromTranslation(forCurrent));
          setBodyEpoch((n) => n + 1);
        } else if (selected[0] && !selected.includes(targetLang)) {
          setTargetLang(selected[0]);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Translate failed");
      } finally {
        setIsTranslating(false);
        setTranslatingLabel("");
      }
    });
  }

  function saveSourceMeta() {
    startTransition(async () => {
      setError("");
      try {
        await updateArticle(article.id, applicationId, {
          title: source.title || article.title,
          slug,
          content_type: contentType,
          source_language: sourceLanguage,
          source_content: {
            ...source,
            seo_title: source.seo_title || source.title,
            seo_description: source.seo_description || source.summary,
          },
          status,
          scheduled_publish_at: fromLocalInput(scheduledPublishAt),
          target_languages: targetLanguages,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Field label="Content type">
            <select
              className={inputClass}
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ContentType)}
            >
              {(["ARTICLE", "NEWS", "ANNOUNCEMENT"] as const).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source language">
            <select
              className={inputClass}
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l.id} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lifecycle status">
            <select
              className={inputClass}
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as ContentLifecycleStatus)
              }
            >
              {(
                [
                  "DRAFT",
                  "TRANSLATING",
                  "REVIEW",
                  "APPROVED",
                  "PUBLISHED",
                ] as const
              ).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Slug">
            <input
              className={inputClass}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-from-title"
            />
          </Field>
          <Field label="Estimated publish">
            <input
              type="datetime-local"
              className={inputClass}
              value={scheduledPublishAt}
              onChange={(e) => setScheduledPublishAt(e.target.value)}
            />
          </Field>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <LanguageMultiSelect
            label="Target languages"
            options={allTargets}
            selected={targetLanguages}
            onSelectedChange={(codes) => {
              setTargetLanguages(codes);
              setSelected((prev) => prev.filter((c) => codes.includes(c)));
              if (codes.length && !codes.includes(targetLang)) {
                setTargetLang(codes[0]);
              }
            }}
            showEditingSwitcher={false}
          />
          <p className="mt-2 text-xs text-slate-500">
            Coverage and translate options are limited to these languages.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>
            Published:{" "}
            <strong className="font-semibold text-slate-900">
              {article.published_at
                ? new Date(article.published_at).toLocaleString()
                : "—"}
            </strong>
          </span>
          <span className="text-slate-300">·</span>
          <span>
            Set status to PUBLISHED to stamp publish time; other statuses clear
            it.
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={saveSourceMeta}
            >
              Save settings
            </Button>
            <DeleteArticleButton
              applicationId={applicationId}
              contentId={article.id}
              title={article.title}
              redirectTo={`/applications/${applicationId}/articles`}
            />
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <LanguageMultiSelect
              sourceLabel={sourceLang?.name ?? sourceLanguage}
              options={targets}
              statuses={statuses}
              selected={selected}
              activeCode={targetLang}
              onSelectedChange={setSelected}
              onActiveChange={setTargetLang}
              translateAction={
                <BatchTranslateButton
                  count={selected.length}
                  disabled={pending}
                  loading={isTranslating}
                  onClick={runBatchTranslate}
                />
              }
            />
          </div>
        </div>
        {isTranslating ? (
          <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700"
              aria-hidden
            />
            Translating selected languages: {translatingLabel}…
          </div>
        ) : null}
      </Card>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--hub-border)] bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Source
                </div>
                <div className="mt-0.5 font-semibold text-slate-900">
                  {sourceLang?.name ?? sourceLanguage}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={saveSourceMeta}
              >
                Save source
              </Button>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <Field label="Title">
              <input
                className={inputClass}
                value={source.title}
                onChange={(e) =>
                  setSource((s) => ({ ...s, title: e.target.value }))
                }
              />
            </Field>
            <Field label="Description">
              <textarea
                className={textareaClass}
                rows={3}
                value={source.summary}
                onChange={(e) =>
                  setSource((s) => ({ ...s, summary: e.target.value }))
                }
              />
            </Field>
            <Field label="Body">
              <HtmlEditor
                key={`source-body-${article.id}`}
                ref={sourceBodyRef}
                value={source.body}
                onChange={(html) =>
                  setSource((s) => ({ ...s, body: html }))
                }
                placeholder="Write article body…"
              />
            </Field>
          </div>
        </Card>

        <Card className="overflow-hidden border-[var(--diy-red)]/20">
          <div className="border-b border-[var(--hub-border)] bg-[var(--diy-red-soft)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <div className="text-xs font-semibold tracking-wide text-[var(--diy-red)] uppercase">
                  Editing
                </div>
                <div className="mt-0.5 font-semibold text-slate-900">
                  {targetMeta?.name ?? targetLang}
                </div>
              </div>
              <Badge tone={statusTone(langStatus)}>{langStatus}</Badge>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <Field label="Title">
              <input
                className={inputClass}
                value={draft.title}
                disabled={isTranslating}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                placeholder={`Title in ${targetMeta?.name ?? targetLang}`}
              />
            </Field>
            <Field label="Description">
              <textarea
                className={textareaClass}
                rows={3}
                value={draft.summary}
                disabled={isTranslating}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, summary: e.target.value }))
                }
                placeholder={`Description in ${targetMeta?.name ?? targetLang}`}
              />
            </Field>
            <Field label="Body">
              <HtmlEditor
                key={`target-body-${article.id}-${targetLang}-${bodyEpoch}`}
                value={draft.body}
                disabled={isTranslating}
                onChange={(html) => setDraft((d) => ({ ...d, body: html }))}
                placeholder={`Body in ${targetMeta?.name ?? targetLang}`}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {isDirty ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || isTranslating || !draft.title.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      setError("");
                      try {
                        await saveManualContentTranslation({
                          contentId: article.id,
                          languageCode: targetLang,
                          fields: {
                            ...draft,
                            seo_title: draft.seo_title || draft.title,
                            seo_description:
                              draft.seo_description || draft.summary,
                          },
                          applicationId,
                        });
                        router.refresh();
                        if (showHistory) loadHistory();
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : "Save failed"
                        );
                      }
                    })
                  }
                >
                  Save changes
                </Button>
              ) : hasSavedContent ? (
                <span className="text-xs font-medium text-emerald-700">
                  Saved
                </span>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={
                  pending ||
                  isTranslating ||
                  langStatus === "APPROVED" ||
                  !draft.title.trim()
                }
                onClick={() =>
                  startTransition(async () => {
                    setError("");
                    try {
                      const current = fieldsFromTranslation(targetTranslation);
                      const changed =
                        draft.title !== current.title ||
                        draft.summary !== current.summary ||
                        draft.body !== current.body;
                      let contentTranslationId = targetTranslation?.id;
                      if (!contentTranslationId || changed) {
                        const saved = await saveManualContentTranslation({
                          contentId: article.id,
                          languageCode: targetLang,
                          fields: {
                            ...draft,
                            seo_title: draft.seo_title || draft.title,
                            seo_description:
                              draft.seo_description || draft.summary,
                          },
                          applicationId,
                        });
                        contentTranslationId = saved.id;
                      }
                      await setContentTranslationStatus({
                        contentTranslationId,
                        status: "APPROVED",
                        applicationId,
                        contentId: article.id,
                      });
                      router.refresh();
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Approve failed"
                      );
                    }
                  })
                }
              >
                {langStatus === "APPROVED" ? "Approved" : "Approve"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending || historyLoading || isTranslating}
                onClick={() =>
                  showHistory ? setShowHistory(false) : loadHistory()
                }
              >
                {showHistory
                  ? "Close history"
                  : historyLoading
                    ? "Loading…"
                    : "History"}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {showHistory ? (
        <ArticleVersionPanel
          versions={versions}
          draft={draft}
          loading={historyLoading}
          error={historyError}
          pending={pending}
          onRestore={setDraft}
          onDelete={(versionId, versionNumber) => {
            if (
              !confirm(
                `Delete version v${versionNumber}? This cannot be undone.`
              )
            ) {
              return;
            }
            startTransition(async () => {
              setHistoryError("");
              try {
                await deleteContentTranslationVersion({
                  versionId,
                  applicationId,
                  contentId: article.id,
                });
                setVersions((prev) =>
                  prev.filter((item) => item.id !== versionId)
                );
              } catch (err) {
                setHistoryError(
                  err instanceof Error
                    ? err.message
                    : "Failed to delete version"
                );
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}
