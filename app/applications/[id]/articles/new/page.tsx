"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getApplication } from "@/lib/actions/applications";
import { listContentTypes } from "@/lib/actions/content-types";
import { listLanguages } from "@/lib/actions/languages";
import { previewTranslateArticle, saveNewArticle } from "@/lib/actions/press";
import { DEFAULT_CONTENT_TYPE_CODE } from "@/lib/content-types";
import type {
  ContentTypeRecord,
  Language,
  SourceContentFields,
} from "@/lib/types";
import { emptySourceContent } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  PageHeader,
  inputClass,
  textareaClass,
} from "@/components/ui";
import {
  BatchTranslateButton,
  LanguageMultiSelect,
} from "@/components/language-multi-select";
import { HtmlEditor, type HtmlEditorHandle } from "@/components/html-editor";
import { MARKETS } from "@/lib/markets";
import { languageKey } from "@/lib/target-languages";
import { TranslationQualityPanel } from "@/components/translation-quality-panel";
import { applyQualityAction } from "@/lib/translation-quality/apply-action";
import type { QualityAction, QualityTargetField } from "@/lib/translation-quality/types";

type HeldTranslation = {
  fields: SourceContentFields;
  origin: "system" | "manual";
};

export default function NewArticlePage() {
  const { id: applicationId } = useParams<{ id: string }>();
  const router = useRouter();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [contentTypes, setContentTypes] = useState<ContentTypeRecord[]>([]);
  const [contentType, setContentType] = useState(DEFAULT_CONTENT_TYPE_CODE);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [market, setMarket] = useState("");
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [editingCode, setEditingCode] = useState("");
  const [held, setHeld] = useState<Record<string, HeldTranslation>>({});
  const [bodyEpoch, setBodyEpoch] = useState(0);
  const [canApprove, setCanApprove] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLabel, setTranslatingLabel] = useState("");
  const [acceptedActionIds, setAcceptedActionIds] = useState<string[]>([]);
  const [ignoredActionIds, setIgnoredActionIds] = useState<string[]>([]);
  const [scorePreview, setScorePreview] = useState<{
    field: QualityTargetField;
    text: string;
  } | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [savingIntent, setSavingIntent] = useState<"draft" | "approve" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const sourceBodyRef = useRef<HtmlEditorHandle>(null);
  const targetBodyRef = useRef<HtmlEditorHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const heldRef = useRef(held);
  heldRef.current = held;
  const titleRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    getApplication(applicationId).then((app) => {
      setCanApprove(!!app?.access.can_approve);
    });
  }, [applicationId]);

  useEffect(() => {
    listLanguages().then((list) => {
      setLanguages(list);
      if (list.some((l) => l.code === "en")) setSourceLanguage("en");
      else if (list[0]) setSourceLanguage(list[0].code);
    });
    listContentTypes(applicationId).then((types) => {
      setContentTypes(types);
      const general = types.find(
        (type) => type.code === DEFAULT_CONTENT_TYPE_CODE
      );
      setContentType(general?.code ?? types[0]?.code ?? DEFAULT_CONTENT_TYPE_CODE);
    });
  }, [applicationId]);

  const targetOptions = useMemo(
    () => languages.filter((l) => languageKey(l.code) !== languageKey(sourceLanguage)),
    [languages, sourceLanguage]
  );

  useEffect(() => {
    setTargetLanguages((prev) =>
      prev.filter((code) => languageKey(code) !== languageKey(sourceLanguage))
    );
  }, [sourceLanguage]);

  useEffect(() => {
    setEditingCode((current) => {
      if (
        current &&
        targetLanguages.some((code) => languageKey(code) === languageKey(current))
      ) {
        return current;
      }
      return targetLanguages[0] ?? "";
    });
  }, [targetLanguages]);

  useEffect(() => {
    setAcceptedActionIds([]);
    setIgnoredActionIds([]);
    setScorePreview(null);
  }, [editingCode]);

  const source = useMemo<SourceContentFields>(
    () => ({
      title,
      summary: description,
      body,
      seo_title: title,
      seo_description: description,
    }),
    [title, description, body]
  );

  const draft =
    (editingCode && held[languageKey(editingCode)]?.fields) || emptySourceContent();
  const editingName = languages.find(
    (language) => languageKey(language.code) === languageKey(editingCode)
  )?.name;

  function liveSource(): SourceContentFields {
    const liveBody = sourceBodyRef.current?.getHTML()?.trim() || body;
    return {
      title: title.trim(),
      summary: description.trim(),
      body: liveBody,
      seo_title: title.trim(),
      seo_description: description.trim(),
    };
  }

  function updateDraft(patch: Partial<SourceContentFields>) {
    if (!editingCode) return;
    const key = languageKey(editingCode);
    setHeld((current) => {
      const existing = current[key]?.fields ?? emptySourceContent();
      return {
        ...current,
        [key]: { origin: "manual", fields: { ...existing, ...patch } },
      };
    });
  }

  function runTranslate() {
    if (targetLanguages.length === 0) return;
    const sourceFields = liveSource();
    if (sourceFields.body !== body) setBody(sourceFields.body);
    setError("");
    setIsTranslating(true);
    setTranslatingLabel(
      targetLanguages
        .map(
          (code) =>
            languages.find((language) => languageKey(language.code) === languageKey(code))
              ?.name ?? code
        )
        .join(", ")
    );
    startTransition(async () => {
      try {
        const results = await previewTranslateArticle({
          applicationId,
          sourceLanguage,
          targetLanguages,
          sourceFields,
        });
        setHeld((current) => {
          const next = { ...current };
          for (const row of results) {
            next[languageKey(row.language_code)] = {
              origin: "system",
              fields: row.fields,
            };
          }
          return next;
        });
        setBodyEpoch((epoch) => epoch + 1);
        setAcceptedActionIds([]);
        setIgnoredActionIds([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Translate failed");
      } finally {
        setIsTranslating(false);
        setTranslatingLabel("");
      }
    });
  }

  function acceptQualityAction(action: QualityAction) {
    if (!editingCode) return;
    const key = languageKey(editingCode);
    const existing = heldRef.current[key]?.fields ?? emptySourceContent();
    const liveBody = targetBodyRef.current?.getHTML()?.trim();
    const fields =
      action.targetField === "content" && liveBody
        ? { ...existing, body: liveBody }
        : existing;
    try {
      const next = applyQualityAction(fields, action);
      const row: HeldTranslation = { origin: "manual", fields: next };
      heldRef.current = { ...heldRef.current, [key]: row };
      setHeld(heldRef.current);
      if (action.targetField === "content") setBodyEpoch((epoch) => epoch + 1);
      if (action.proposedText) {
        setScorePreview({ field: action.targetField, text: action.proposedText });
      }
      setAcceptedActionIds((ids) =>
        ids.includes(action.id) ? ids : [...ids, action.id]
      );
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the suggestion.");
    }
  }

  const scorePreviewRef = useRef(scorePreview);
  scorePreviewRef.current = scorePreview;

  useEffect(() => {
    if (!scrollRequest) return;
    const preview = scorePreviewRef.current;
    if (!preview) return;
    const phrase = preview.text.trim();
    const frame = requestAnimationFrame(() => {
      if (preview.field === "content") {
        document.querySelector(".quality-locate")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
        return;
      }
      const el = preview.field === "title" ? titleRef.current : summaryRef.current;
      if (!el) return;
      const at = el.value.toLowerCase().indexOf(phrase.toLowerCase());
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (at >= 0) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(at, at + phrase.length);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest]);

  function save(mode: "draft" | "approve") {
    if (!title.trim()) {
      setError("Add a title first.");
      return;
    }
    const sourceFields = liveSource();
    if (sourceFields.body !== body) setBody(sourceFields.body);
    const scheduled = formRef.current
      ? String(new FormData(formRef.current).get("scheduled_publish_at") ?? "")
      : "";
    setError("");
    setSavingIntent(mode);
    startTransition(async () => {
      try {
        const saved = await saveNewArticle({
          applicationId,
          contentId: createdId,
          title: sourceFields.title,
          contentType,
          sourceLanguage,
          sourceFields,
          market: market || null,
          targetLanguages,
          scheduledPublishAt: scheduled ? new Date(scheduled).toISOString() : null,
          mode,
          translations: targetLanguages.flatMap((code) => {
            const row = heldRef.current[languageKey(code)];
            if (!row) return [];
            return [
              {
                languageCode: code,
                fields: row.fields,
                origin: row.origin,
              },
            ];
          }),
        });
        setCreatedId(saved.id);
        router.push(`/applications/${applicationId}/articles/${saved.id}/edit`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      } finally {
        setSavingIntent(null);
      }
    });
  }

  return (
    <div>
      <PageHeader
        title="New Draft"
        back={{
          href: `/applications/${applicationId}/articles`,
          label: "Back to articles",
        }}
      />
      <form
        ref={formRef}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save("draft");
        }}
      >
        <Card className="space-y-4 p-5">
          <Field label="Title">
            <input
              className={inputClass}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Content type">
              <select
                className={inputClass}
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
              >
                {contentTypes.map((type) => (
                  <option key={type.id} value={type.code}>
                    {type.name}
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
            <Field label="Market">
              <select
                className={inputClass}
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              >
                <option value="">No market</option>
                {MARKETS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estimated publish (optional)">
              <input
                type="datetime-local"
                name="scheduled_publish_at"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              className={textareaClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Body">
            <HtmlEditor
              ref={sourceBodyRef}
              value={body}
              onChange={setBody}
              placeholder="Write article body…"
              minHeightClass="min-h-[14rem]"
            />
          </Field>
        </Card>

        <Card className="space-y-3 p-4">
          <LanguageMultiSelect
            label="Target languages"
            sourceLabel={
              languages.find((language) => languageKey(language.code) === languageKey(sourceLanguage))
                ?.name ?? sourceLanguage
            }
            options={targetOptions}
            selected={targetLanguages}
            activeCode={editingCode || undefined}
            onSelectedChange={setTargetLanguages}
            onActiveChange={setEditingCode}
            translateAction={
              <BatchTranslateButton
                count={targetLanguages.length}
                disabled={pending}
                loading={isTranslating}
                onClick={runTranslate}
              />
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

        {editingCode ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="overflow-hidden border-[var(--diy-red)]/20">
              <div className="border-b border-[var(--hub-border)] bg-[var(--diy-red-soft)] px-4 py-3">
                <span className="block text-xs font-semibold tracking-wide text-[var(--diy-red)] uppercase">
                  Editing
                </span>
                <span className="mt-0.5 block font-semibold text-slate-900">
                  {editingName ?? editingCode}
                </span>
              </div>
              <div className="space-y-3 p-4">
                <Field label="Title">
                  <input
                    ref={titleRef}
                    className={`${inputClass} ${scorePreview?.field === "title" ? "ring-2 ring-amber-400" : ""}`}
                    value={draft.title}
                    disabled={isTranslating}
                    onChange={(e) => updateDraft({ title: e.target.value })}
                    spellCheck={false}
                    placeholder={`Title in ${editingName ?? editingCode}`}
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    ref={summaryRef}
                    className={`${textareaClass} ${scorePreview?.field === "summary" ? "ring-2 ring-amber-400" : ""}`}
                    rows={3}
                    value={draft.summary}
                    disabled={isTranslating}
                    onChange={(e) => updateDraft({ summary: e.target.value })}
                    spellCheck={false}
                    placeholder={`Description in ${editingName ?? editingCode}`}
                  />
                </Field>
                <Field label="Body">
                  <HtmlEditor
                    ref={targetBodyRef}
                    revision={`target-${editingCode}-${bodyEpoch}`}
                    highlight={scorePreview?.field === "content" ? scorePreview.text : ""}
                    value={draft.body}
                    disabled={isTranslating}
                    onChange={(html) => updateDraft({ body: html })}
                    placeholder={`Body in ${editingName ?? editingCode}`}
                  />
                </Field>
              </div>
            </Card>
            <TranslationQualityPanel
              key={editingCode}
              variant="rail"
              sessionOnly
              applicationId={applicationId}
              contentId=""
              languageCode={editingCode}
              languageName={editingName ?? editingCode}
              sourceLanguage={sourceLanguage}
              source={source}
              draft={draft}
              savedAt=""
              canReview
              unsaved
              acceptedActionIds={acceptedActionIds}
              ignoredActionIds={ignoredActionIds}
              onLatestRunId={() => undefined}
              onAccept={acceptQualityAction}
              onIgnore={(actionId) =>
                setIgnoredActionIds((ids) =>
                  ids.includes(actionId) ? ids : [...ids, actionId]
                )
              }
              onPreview={setScorePreview}
              onShow={(target) => {
                setScorePreview(target);
                setScrollRequest((current) => current + 1);
              }}
            />
          </div>
        ) : null}

        {canApprove ? (
          <p className="text-sm text-[var(--hub-muted)]">
            Save as draft leaves this for later review. Save and approve marks the article and its translations approved.
          </p>
        ) : (
          <p className="text-sm text-[var(--hub-muted)]">
            Translate and analyze a language before you create the article. It is saved as a draft, and HOD and above approve it.
          </p>
        )}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant={canApprove ? "secondary" : "primary"}
            disabled={pending}
          >
            {isTranslating
              ? "Translating…"
              : pending && savingIntent === "draft"
                ? "Saving…"
                : canApprove
                  ? "Save as draft"
                  : "Create article"}
          </Button>
          {canApprove ? (
            <Button type="button" disabled={pending} onClick={() => save("approve")}>
              {isTranslating
                ? "Translating…"
                : pending && savingIntent === "approve"
                  ? "Approving…"
                  : "Save and approve"}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
