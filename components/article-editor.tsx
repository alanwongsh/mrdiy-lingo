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
  ContentTypeRecord,
  Language,
  ArticleComment,
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
import { ArticleComments } from "@/components/article-comments";
import { HtmlEditor, type HtmlEditorHandle } from "@/components/html-editor";
import { MARKETS } from "@/lib/markets";
import { languageKey, normalizeTargetLanguages } from "@/lib/target-languages";
import { FilterSelect } from "./filter-select";

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

function CopyFieldButton({
  text,
  copied,
  label,
  onCopy,
}: {
  text: string;
  copied: boolean;
  label: string;
  onCopy: () => void;
}) {
  const name = copied ? "Copied" : `Copy ${label.toLowerCase()}`;
  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-40"
      aria-label={name}
      title={name}
      disabled={!text.trim()}
      onClick={onCopy}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}

function writeClipboard(text: string): Promise<void> {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (copied) return Promise.resolve();
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("Could not copy."));
}

function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function resolveTargets(
  codes: string[],
  languages: Language[],
  source: string
) {
  return normalizeTargetLanguages(
    codes,
    source,
    languages.map((language) => language.code)
  );
}

function findLanguage(languages: Language[], code: string) {
  const key = languageKey(code);
  return languages.find((language) => languageKey(language.code) === key);
}

function findTranslation(
  translations: ContentTranslation[],
  code: string
) {
  const key = languageKey(code);
  return translations.find((row) => languageKey(row.language_code) === key);
}

const DRAFT_STATUSES = ["DRAFT", "TRANSLATING", "REVIEW"] as const;

function lifecycleChoices(
  canApprove: boolean,
  current: ContentLifecycleStatus
): ContentLifecycleStatus[] {
  const choices: ContentLifecycleStatus[] = [...DRAFT_STATUSES];
  if (canApprove) {
    choices.push("APPROVED", "PUBLISHED");
  } else if (current === "APPROVED" || current === "PUBLISHED") {
    choices.push(current);
  }
  return choices;
}

export function ArticleEditor({
  applicationId,
  article,
  languages,
  contentTypes,
  actor,
  canApprove,
  comments,
  commentsError,
}: {
  applicationId: string;
  article: ArticleWithTranslations;
  languages: Language[];
  contentTypes: ContentTypeRecord[];
  actor: { username: string; name: string } | null;
  canApprove: boolean;
  comments: ArticleComment[];
  commentsError?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLabel, setTranslatingLabel] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [editingOpen, setEditingOpen] = useState(true);
  const [status, setStatus] = useState(article.status);
  const [contentType, setContentType] = useState(article.content_type);
  const [scheduledPublishAt, setScheduledPublishAt] = useState(
    toLocalInput(article.scheduled_publish_at)
  );
  const [source, setSource] = useState(article.source_content);
  const [sourceLanguage, setSourceLanguage] = useState(article.source_language);
  const [market, setMarket] = useState(article.market ?? "");
  const initialTargets = resolveTargets(
    article.target_languages ?? [],
    languages,
    article.source_language
  );
  const initialLang = initialTargets[0] ?? "";
  const [targetLanguages, setTargetLanguages] = useState<string[]>(initialTargets);
  const allTargets = useMemo(
    () =>
      languages.filter(
        (language) => languageKey(language.code) !== languageKey(sourceLanguage)
      ),
    [languages, sourceLanguage]
  );
  const [targetLang, setTargetLang] = useState(initialLang);
  const commentLanguages = useMemo(() => {
    const codes = new Set(
      [sourceLanguage, ...targetLanguages].map((code) => languageKey(code))
    );
    const scoped = languages.filter((language) =>
      codes.has(languageKey(language.code))
    );
    return scoped.length > 0 ? scoped : languages;
  }, [languages, sourceLanguage, targetLanguages]);
  const [draft, setDraft] = useState<SourceContentFields>(() =>
    fieldsFromTranslation(findTranslation(article.translations, initialLang))
  );
  const [bodyEpoch, setBodyEpoch] = useState(0);
  const [versions, setVersions] = useState<ContentTranslationVersion[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [historyError, setHistoryError] = useState("");
  const sourceBodyRef = useRef<HtmlEditorHandle>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  function copyField(key: string, text: string, label: string) {
    return (
      <CopyFieldButton
        text={text}
        copied={copied === key}
        label={label}
        onCopy={() => {
          void writeClipboard(text)
            .then(() => {
              setError("");
              setCopied(key);
              window.setTimeout(
                () => setCopied((current) => (current === key ? "" : current)),
                2000
              );
            })
            .catch(() => setError(`Could not copy the ${label.toLowerCase()}.`));
        }}
      />
    );
  }

  const sourceLang = findLanguage(languages, sourceLanguage);
  const editingCode =
    targetLanguages.find((code) => languageKey(code) === languageKey(targetLang)) ??
    "";
  const targetMeta = findLanguage(languages, editingCode);
  const targetTranslation = findTranslation(article.translations, editingCode);
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
      allTargets.map((language) => ({
        code: language.code,
        status:
          findTranslation(article.translations, language.code)?.status ??
          ("MISSING" as TranslationStatus),
      })),
    [allTargets, article.translations]
  );

  function onTargetsChange(codes: string[]) {
    const resolved = resolveTargets(codes, languages, sourceLanguage);
    setTargetLanguages(resolved);
    setTargetLang((current) => {
      const match = resolved.find((code) => languageKey(code) === languageKey(current));
      return match ?? resolved[0] ?? "";
    });
  }

  useEffect(() => {
    setStatus(article.status);
    setContentType(article.content_type);
    setScheduledPublishAt(toLocalInput(article.scheduled_publish_at));
    setSource(article.source_content);
    setSourceLanguage(article.source_language);
    setMarket(article.market ?? "");
    const resolved = resolveTargets(
      article.target_languages ?? [],
      languages,
      article.source_language
    );
    setTargetLanguages(resolved);
    setTargetLang((current) => {
      const match = resolved.find((code) => languageKey(code) === languageKey(current));
      if (match) return match;
      return resolved[0] ?? "";
    });
  }, [article, languages]);

  useEffect(() => {
    setTargetLanguages((prev) => {
      const next = prev.filter((code) => languageKey(code) !== languageKey(sourceLanguage));
      return next.length === prev.length ? prev : next;
    });
    setTargetLang((current) => {
      if (languageKey(current) !== languageKey(sourceLanguage)) return current;
      return allTargets[0]?.code ?? "";
    });
  }, [sourceLanguage, allTargets]);

  const translationToken = `${editingCode}:${targetTranslation?.id ?? ""}:${targetTranslation?.updated_at ?? ""}`;
  const translationTokenRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip first run — draft already seeded from useState so we don't remount TipTap.
    if (translationTokenRef.current === null) {
      translationTokenRef.current = translationToken;
      return;
    }
    if (translationTokenRef.current === translationToken) return;
    translationTokenRef.current = translationToken;
    setDraft(fieldsFromTranslation(targetTranslation));
    setBodyEpoch((n) => n + 1);
    setShowHistory(false);
    setVersions([]);
    setHistoryError("");
  }, [translationToken, targetTranslation]);

  useEffect(() => {
    if (!showHistory) return;
    historyRef.current?.scrollIntoView({ block: "nearest" });
  }, [showHistory]);

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
    if (targetLanguages.length === 0) return;
    setError("");
    setIsTranslating(true);
    setTranslatingLabel(
      targetLanguages
        .map((code) => findLanguage(languages, code)?.name ?? code)
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
          targetLanguages: targetLanguages.filter(
            (code) => languageKey(code) !== languageKey(sourceLanguage)
          ),
          applicationId,
          sourceLanguage,
          sourceFields,
        });
        const forCurrent = results.find(
          (result) => languageKey(result.language_code) === languageKey(targetLang)
        );
        if (forCurrent) {
          setDraft(fieldsFromTranslation(forCurrent));
          setBodyEpoch((n) => n + 1);
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

  function saveSettings() {
    startTransition(async () => {
      setError("");
      try {
        await updateArticle(article.id, applicationId, {
          title: article.title,
          slug: article.slug,
          content_type: contentType,
          source_language: sourceLanguage,
          source_content: article.source_content,
          status,
          scheduled_publish_at: fromLocalInput(scheduledPublishAt),
          target_languages: targetLanguages,
          market: market || null,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function saveSource() {
    const liveBody = sourceBodyRef.current?.getHTML() ?? source.body;
    startTransition(async () => {
      setError("");
      try {
        await updateArticle(article.id, applicationId, {
          title: source.title || article.title,
          slug: article.slug,
          content_type: contentType,
          source_language: sourceLanguage,
          source_content: {
            ...article.source_content,
            ...source,
            body: liveBody,
          },
          status,
          scheduled_publish_at: fromLocalInput(scheduledPublishAt),
          target_languages: targetLanguages,
          market: market || null,
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            fullWidth
            label="Content type"
            value={contentType}
            onChange={(value) => setContentType(value)}
            options={contentTypes.map((type) => ({
              value: type.code,
              label: type.name,
            }))}
            placeholder="Select content type"
          />
          <FilterSelect
            fullWidth
            label="Source language"
            value={sourceLanguage}
            onChange={(value) => setSourceLanguage(value)}
            options={languages.map((language) => ({
              value: language.code,
              label: language.name,
            }))}
            placeholder="Select source language"
          />
          <FilterSelect
            fullWidth
            label="Market"
            value={market}
            onChange={(value) => setMarket(value)}
            options={MARKETS.map((market) => ({
              value: market.code,
              label: market.code + " · " + market.name,
            }))}
            placeholder="Select market"
          />
          <FilterSelect
            fullWidth
            label="Lifecycle status"
            value={status}
            onChange={(value) => setStatus(value)}
            options={lifecycleChoices(canApprove, article.status).map((status) => ({
              value: status,
              label: status,
            }))}
            placeholder="Select lifecycle status"
          />
          <Field label="Estimated publish">
            <input
              type="datetime-local"
              className={inputClass}
              value={scheduledPublishAt}
              onChange={(e) => setScheduledPublishAt(e.target.value)}
            />
          </Field>
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
          {/* <span className="text-slate-300">·</span>
          <span>
            Set status to PUBLISHED to stamp publish time; other statuses clear
            it.
          </span> */}
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={saveSettings}
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
        <LanguageMultiSelect
          label="Languages"
          sourceLabel={sourceLang?.name ?? sourceLanguage}
          options={allTargets}
          statuses={statuses}
          selected={targetLanguages}
          activeCode={editingCode || undefined}
          onSelectedChange={onTargetsChange}
          onActiveChange={setTargetLang}
          translateAction={
            <BatchTranslateButton
              count={targetLanguages.length}
              disabled={pending}
              loading={isTranslating}
              onClick={runBatchTranslate}
            />
          }
          editingAction={
            <Button
              type="button"
              variant="secondary"
              disabled={pending || historyLoading || isTranslating || !editingCode}
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
          }
        />
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

      {showHistory ? (
        <div ref={historyRef}>
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
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--hub-border)] bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                aria-expanded={sourceOpen}
                onClick={() => setSourceOpen((open) => !open)}
              >
                <span className="text-[var(--diy-red)]" aria-hidden>
                  {sourceOpen ? "▾" : "▸"}
                </span>
                <span>
                  <span className="block text-xs font-semibold tracking-wide text-[var(--diy-red)] uppercase">
                    Source
                  </span>
                  <span className="mt-0.5 block font-semibold text-slate-900">
                    {sourceLang?.name ?? sourceLanguage}
                  </span>
                </span>
              </button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={saveSource}
              >
                Save source
              </Button>
            </div>
          </div>
          <div className="space-y-3 p-4" hidden={!sourceOpen}>
            <Field label="Title" action={copyField("source-title", source.title, "Title")}>
              <input
                className={inputClass}
                value={source.title}
                onChange={(e) =>
                  setSource((s) => ({ ...s, title: e.target.value }))
                }
              />
            </Field>
            <Field
              label="Description"
              action={copyField("source-description", source.summary, "Description")}
            >
              <textarea
                className={textareaClass}
                rows={3}
                value={source.summary}
                onChange={(e) =>
                  setSource((s) => ({ ...s, summary: e.target.value }))
                }
              />
            </Field>
            <Field label="Body" action={copyField("source-body", source.body, "Body")}>
              <HtmlEditor
                ref={sourceBodyRef}
                revision={`source-${article.id}`}
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
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                aria-expanded={editingOpen}
                onClick={() => setEditingOpen((open) => !open)}
              >
                <span className="text-[var(--diy-red)]" aria-hidden>
                  {editingOpen ? "▾" : "▸"}
                </span>
                <span>
                  <span className="block text-xs font-semibold tracking-wide text-[var(--diy-red)] uppercase">
                    Editing
                  </span>
                  <span className="mt-0.5 block font-semibold text-slate-900">
                    {targetMeta?.name ?? "Choose a language"}
                  </span>
                </span>
              </button>
              {editingCode ? (
                <Badge tone={statusTone(langStatus)}>{langStatus}</Badge>
              ) : null}
            </div>
          </div>
          <div className="space-y-3 p-4" hidden={!editingOpen}>
            {!editingCode ? (
              <p className="text-sm text-[var(--hub-muted)]">
                Choose a language above to edit or auto-translate it.
              </p>
            ) : (
            <>
            <Field label="Title" action={copyField("target-title", draft.title, "Title")}>
              <input
                className={inputClass}
                value={draft.title}
                disabled={isTranslating}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
                spellCheck={false}
                placeholder={`Title in ${targetMeta?.name ?? editingCode}`}
              />
            </Field>
            <Field
              label="Description"
              action={copyField("target-description", draft.summary, "Description")}
            >
              <textarea
                className={textareaClass}
                rows={3}
                value={draft.summary}
                disabled={isTranslating}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, summary: e.target.value }))
                }
                spellCheck={false}
                placeholder={`Description in ${targetMeta?.name ?? editingCode}`}
              />
            </Field>
            <Field label="Body" action={copyField("target-body", draft.body, "Body")}>
              <HtmlEditor
                revision={`target-${article.id}-${editingCode}-${bodyEpoch}`}
                value={draft.body}
                disabled={isTranslating}
                onChange={(html) => setDraft((d) => ({ ...d, body: html }))}
                placeholder={`Body in ${targetMeta?.name ?? editingCode}`}
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
                          languageCode: editingCode,
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
              {canApprove ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    pending ||
                    isTranslating ||
                    langStatus === "APPROVED" ||
                    !draft.title.trim() ||
                    !actor
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
                            languageCode: editingCode,
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
              ) : (
                <span className="text-xs text-slate-500">
                  HOD and above can approve this language.
                </span>
              )}
              {langStatus === "APPROVED" && targetTranslation?.approved_by_name ? (
                <span className="text-xs text-slate-500">
                  by {targetTranslation.approved_by_name}
                </span>
              ) : null}
              {canApprove && !actor ? (
                <span className="text-xs text-slate-500">
                  Joget sign-in required to approve
                </span>
              ) : null}
            </div>
            </>
            )}
          </div>
        </Card>
      </div>

      <ArticleComments
        applicationId={applicationId}
        contentId={article.id}
        comments={comments}
        languages={commentLanguages}
        activeLanguage={editingCode || sourceLanguage}
        actor={actor}
        loadError={commentsError}
      />
    </div>
  );
}
