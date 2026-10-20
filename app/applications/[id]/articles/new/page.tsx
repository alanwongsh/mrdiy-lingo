"use client";

import { errorMessage } from "@/lib/errors";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getApplication } from "@/lib/actions/applications";
import { listContentTypes } from "@/lib/actions/content-types";
import { listLanguages } from "@/lib/actions/languages";
import { previewTranslateArticle, saveNewArticle } from "@/lib/actions/press";
import { generateArticleDraft } from "@/lib/actions/drafting";
import { checkIsProduction } from "@/lib/actions/env";
import { DEFAULT_CONTENT_TYPE_CODE } from "@/lib/content-types";
import type {
  ContentTypeRecord,
  Language,
  SourceContentFields,
} from "@/lib/types";
import { emptySourceContent } from "@/lib/types";
import {
  Badge,
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
import { applyQualityAction, qualityActionStillOpen } from "@/lib/translation-quality/apply-action";
import type { QualityAction, QualityTargetField } from "@/lib/translation-quality/types";
import { nthIndexOf } from "@/lib/translation-quality/text";
import { DateTimePicker } from "@/components/date-time-picker";
import { FilterSelect } from "@/components/filter-select";
import { useTimeZone } from "@/components/time-zone";
import { fromZonedInput } from "@/lib/datetime";

type HeldTranslation = {
  fields: SourceContentFields;
  origin: "system" | "manual";
};

export default function NewArticlePage() {
  const { id: applicationId } = useParams<{ id: string }>();
  const router = useRouter();
  const timeZone = useTimeZone();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [contentTypes, setContentTypes] = useState<ContentTypeRecord[]>([]);
  const [contentType, setContentType] = useState(DEFAULT_CONTENT_TYPE_CODE);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [market, setMarket] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [editingCode, setEditingCode] = useState("");
  const [held, setHeld] = useState<Record<string, HeldTranslation>>({});
  const [bodyEpoch, setBodyEpoch] = useState(0);
  const [canApprove, setCanApprove] = useState(false);
  const [canDraft, setCanDraft] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  /** The brief behind the draft now in the form, recorded when the article is saved. */
  const [draftedFrom, setDraftedFrom] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const [sourceEpoch, setSourceEpoch] = useState(0);
  /** Languages approved one by one; saved as approved with the article. */
  const [approvedCodes, setApprovedCodes] = useState<string[]>([]);
  /** Countries from the person's business units. Null means every country. */
  const [allowedMarkets, setAllowedMarkets] = useState<string[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLabel, setTranslatingLabel] = useState("");
  const [acceptedActionIds, setAcceptedActionIds] = useState<string[]>([]);
  const [ignoredActionIds, setIgnoredActionIds] = useState<string[]>([]);
  const [scorePreview, setScorePreview] = useState<{
    field: QualityTargetField;
    text: string;
    /** Which match of the text: 1 is the second one. */
    occurrence?: number;
  } | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [savingIntent, setSavingIntent] = useState<"draft" | "review" | "approve" | null>(null);
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
      setCanDraft(
        !!app?.access.can_edit && !!app?.access.permissions.includes("content.generate")
      );
      const markets = app?.access.markets ?? null;
      setAllowedMarkets(markets);
      // One country to choose from: pick it.
      if (markets?.length === 1) setMarket((current) => current || markets[0]);
    });
    checkIsProduction().then((production) => setPublishing(!production));
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
  const editingApproved = approvedCodes.includes(languageKey(editingCode));

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

  // Languages approved here are kept as they are, so only the rest are sent, counted and named.
  const toTranslate = targetLanguages.filter((code) => !approvedCodes.includes(languageKey(code)));

  function runTranslate() {
    if (toTranslate.length === 0) return;
    const sourceFields = liveSource();
    if (sourceFields.body !== body) setBody(sourceFields.body);
    setError("");
    setIsTranslating(true);
    setTranslatingLabel(
      toTranslate
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
          targetLanguages: toTranslate,
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
        setError(errorMessage(err, "Translate failed"));
      } finally {
        setIsTranslating(false);
        setTranslatingLabel("");
      }
    });
  }

  function acceptQualityAction(action: QualityAction, _stored?: boolean, quiet = false) {
    if (!editingCode) return;
    const key = languageKey(editingCode);
    const existing = heldRef.current[key]?.fields ?? emptySourceContent();
    const liveBody = quiet ? "" : targetBodyRef.current?.getHTML()?.trim();
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
      const message = errorMessage(err, "Could not apply the suggestion.");
      // Accept all: an earlier suggestion may already have replaced this wording.
      if (quiet && !qualityActionStillOpen(fields, action)) {
        setAcceptedActionIds((ids) =>
          ids.includes(action.id) ? ids : [...ids, action.id]
        );
        return;
      }
      setError(
        quiet
          ? "Some suggestions could not be applied automatically. They are still open, so edit them by hand."
          : message
      );
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
      const at = nthIndexOf(el.value.toLowerCase(), phrase.toLowerCase(), preview.occurrence ?? 0);
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (at >= 0) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(at, at + phrase.length);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest]);

  async function draftWithAi() {
    if (!aiPrompt.trim()) {
      setError("Describe the article you want drafted.");
      return;
    }
    if (!market) {
      setError("Choose a market first.");
      return;
    }
    const current = liveSource();
    if (
      (current.title || current.summary || current.body.replace(/<[^>]+>/g, "").trim()) &&
      !window.confirm("Replace the title, description, and body with the AI draft?")
    ) {
      return;
    }
    setError("");
    setIsDrafting(true);
    try {
      const fields = await generateArticleDraft({
        applicationId,
        prompt: aiPrompt,
        contentType,
        sourceLanguage,
        market,
      });
      setTitle(fields.title);
      setDescription(fields.summary);
      setBody(fields.body);
      setSourceEpoch((epoch) => epoch + 1);
      setDraftedFrom(aiPrompt.trim());
    } catch (err) {
      setError(errorMessage(err, "Drafting failed"));
    } finally {
      setIsDrafting(false);
    }
  }

  function save(mode: "draft" | "review" | "approve") {
    if (!title.trim()) {
      setError("Add a title first.");
      return;
    }
    if (!market) {
      setError("Choose a market first.");
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
          scheduledPublishAt: publishing && scheduled ? fromZonedInput(scheduled, timeZone) : null,
          mode,
          aiPrompt: draftedFrom || null,
          translations: targetLanguages.flatMap((code) => {
            const row = heldRef.current[languageKey(code)];
            if (!row) return [];
            return [
              {
                languageCode: code,
                fields: row.fields,
                origin: row.origin,
                approved: approvedCodes.includes(languageKey(code)),
              },
            ];
          }),
        });
        setCreatedId(saved.id);
        router.push(`/applications/${applicationId}/articles/${saved.id}/edit`);
      } catch (err) {
        setError(errorMessage(err, "Failed"));
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
        {canDraft ? (
          <Card className="space-y-3 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-slate-900">Draft with AI</h2>
              {draftedFrom ? <Badge tone="warn">AI draft in the form</Badge> : null}
            </div>
            <Field label="Brief">
              <textarea
                className={textareaClass}
                rows={4}
                maxLength={4000}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="What the article is about, key facts, dates, and tone. For example: Press release on the new Penang store opening on 1 Dec, 10% off for the first 3 days."
              />
            </Field>
            <p className="text-xs text-[var(--hub-muted)]">
              Uses the content type, source language, and market chosen below. AI can get facts
              wrong. Check every name, date, price, and promotion, and fill any [placeholders],
              before you submit for review.
            </p>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={isDrafting || !aiPrompt.trim()}
                onClick={draftWithAi}
              >
                {isDrafting ? "Drafting…" : draftedFrom ? "Draft again" : "Write draft"}
              </Button>
            </div>
          </Card>
        ) : null}

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
              <FilterSelect
                fullWidth
                hideEmptyOption
                ariaLabel="Content type"
                value={contentType}
                onChange={setContentType}
                options={contentTypes.map((type) => ({
                  value: type.code,
                  label: type.name,
                }))}
                placeholder="Select content type"
              />
            </Field>
            <Field label="Source language">
              <FilterSelect
                fullWidth
                hideEmptyOption
                ariaLabel="Source language"
                value={sourceLanguage}
                onChange={setSourceLanguage}
                options={languages.map((l) => ({ value: l.code, label: l.name }))}
                placeholder="Select source language"
              />
            </Field>
            <Field label="Market" required>
              <FilterSelect
                fullWidth
                ariaLabel="Market"
                value={market}
                onChange={setMarket}
                options={MARKETS.filter(
                  (item) => allowedMarkets === null || allowedMarkets.includes(item.code)
                ).map((item) => ({
                  value: item.code,
                  label: `${item.code} · ${item.name}`,
                }))}
                placeholder="Choose a market"
              />
            </Field>
            {publishing ? (
              <Field label="Publish time (optional)">
                <DateTimePicker
                  name="scheduled_publish_at"
                  ariaLabel="Publish time"
                  value={publishAt}
                  onChange={setPublishAt}
                />
                <p className="text-xs text-[var(--hub-muted)]">
                  Goes live at this time once approved.
                </p>
              </Field>
            ) : null}
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
              revision={`source-${sourceEpoch}`}
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
            // Same status chips as the editor: approved, translated, edited, or missing.
            statuses={targetLanguages.map((code) => {
              const key = languageKey(code);
              const row = held[key];
              return {
                code,
                status: approvedCodes.includes(key)
                  ? "APPROVED"
                  : !row
                    ? "MISSING"
                    : row.origin === "system"
                      ? "SYSTEM_GENERATED"
                      : "MANUALLY_MODIFIED",
              };
            })}
            activeCode={editingCode || undefined}
            onSelectedChange={setTargetLanguages}
            onActiveChange={setEditingCode}
            translateAction={
              <BatchTranslateButton
                count={toTranslate.length}
                disabled={pending}
                loading={isTranslating}
                onClick={runTranslate}
              />
            }
          />
          <p className="text-xs text-slate-500">
            AI translation covers text only. Images stay the same in every language.
          </p>
          {isTranslating ? (
            <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700"
                aria-hidden
              />
              Translating {translatingLabel}…
            </div>
          ) : null}
        </Card>

        {editingCode ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="overflow-hidden border-[var(--hub-accent)]/20">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hub-border)] bg-[var(--hub-accent-soft)] px-4 py-3">
                <div>
                  <span className="block text-xs font-semibold tracking-wide text-[var(--hub-accent)] uppercase">
                    Editing
                  </span>
                  <span className="mt-0.5 block font-semibold text-slate-900">
                    {editingName ?? editingCode}
                  </span>
                </div>
                {canApprove ? (
                  // Approve one language, as in the editor. It is saved with the article.
                  <div className="flex items-center gap-2">
                    {editingApproved ? <Badge tone="good">Approved on save</Badge> : null}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        isTranslating ||
                        (!editingApproved &&
                          !draft.title.trim() &&
                          !draft.summary.trim() &&
                          !draft.body.trim())
                      }
                      onClick={() => {
                        const key = languageKey(editingCode);
                        setApprovedCodes((current) =>
                          current.includes(key)
                            ? current.filter((item) => item !== key)
                            : [...current, key]
                        );
                      }}
                    >
                      {editingApproved ? "Undo approve" : "Approve"}
                    </Button>
                  </div>
                ) : null}
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
                    highlightOccurrence={scorePreview?.field === "content" ? scorePreview.occurrence ?? 0 : 0}
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
            Save as draft leaves this for later review. Approve a single language with its Approve button; it is
            saved approved with the draft. Save and approve marks the article and all its translations approved.
          </p>
        ) : (
          <p className="text-sm text-[var(--hub-muted)]">
            Save as draft to keep working on it. Submit for review when it is ready, and someone who can approve signs it off.
          </p>
        )}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" disabled={pending}>
            {isTranslating
              ? "Translating…"
              : pending && savingIntent === "draft"
                ? "Saving…"
                : "Save as draft"}
          </Button>
          {canApprove ? null : (
            <Button type="button" disabled={pending} onClick={() => save("review")}>
              {isTranslating
                ? "Translating…"
                : pending && savingIntent === "review"
                  ? "Submitting…"
                  : "Submit for review"}
            </Button>
          )}
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
