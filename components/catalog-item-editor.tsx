"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  approveItem,
  approveItemLanguage,
  deleteItem,
  deleteItemFile,
  requestItemChanges,
  saveItemText,
  submitItem,
  translateItem,
  updateItemDetails,
} from "@/lib/actions/catalog";
import {
  formatBytes,
  formatStamp,
  isStale,
  ITEM_STATUS_LABEL,
  languageProgress,
  CATALOG_FILE_MAX_BYTES,
} from "@/lib/catalog";
import type { CatalogEvent, CatalogField, CatalogItem, CatalogValue, Language } from "@/lib/types";
import { LanguageChip, translateSummary } from "@/components/catalog-item-list";
import { FilterMultiSelect } from "@/components/filter-select";
import { Badge, Button, Card, Field, inputClass, statusTone, textareaClass } from "@/components/ui";

type TextMap = Record<string, string>;

function textMap(values: CatalogValue[], language: string): TextMap {
  const map: TextMap = {};
  for (const value of values) {
    if (value.language_code === language) map[value.field_id] = value.text_value;
  }
  return map;
}

/** Keeps what the person is still typing; takes the saved text for every field they left alone. */
function mergeDraft(draft: TextMap, oldBase: TextMap, nextBase: TextMap): TextMap {
  const merged: TextMap = { ...nextBase };
  for (const key of Object.keys(draft)) {
    if ((draft[key] ?? "") !== (oldBase[key] ?? "")) merged[key] = draft[key];
  }
  return merged;
}

function dirtyFields(draft: TextMap, base: TextMap): string[] {
  return Object.keys(draft).filter((key) => (draft[key] ?? "") !== (base[key] ?? ""));
}

export function CatalogItemEditor({
  applicationId,
  itemLabel,
  item,
  fields,
  values,
  events,
  languages,
  canEdit,
  canApprove,
}: {
  applicationId: string;
  itemLabel: string;
  item: CatalogItem;
  fields: CatalogField[];
  values: CatalogValue[];
  events: CatalogEvent[];
  languages: Language[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const languageName = (code: string) => languages.find((l) => l.code === code)?.name ?? code.toUpperCase();
  const source = item.source_language;

  const [activeLang, setActiveLang] = useState(item.target_languages[0] ?? "");
  const sourceSaved = useMemo(() => textMap(values, source), [values, source]);
  const targetSaved = useMemo(() => textMap(values, activeLang), [values, activeLang]);
  const [sourceBase, setSourceBase] = useState(sourceSaved);
  const [sourceDraft, setSourceDraft] = useState(sourceSaved);
  const [targetBase, setTargetBase] = useState(targetSaved);
  const [targetDraft, setTargetDraft] = useState(targetSaved);
  if (sourceBase !== sourceSaved) {
    setSourceBase(sourceSaved);
    setSourceDraft(mergeDraft(sourceDraft, sourceBase, sourceSaved));
  }
  if (targetBase !== targetSaved) {
    setTargetBase(targetSaved);
    setTargetDraft(mergeDraft(targetDraft, targetBase, targetSaved));
  }
  const sourceDirty = dirtyFields(sourceDraft, sourceSaved);
  const targetDirty = dirtyFields(targetDraft, targetSaved);

  const [name, setName] = useState(item.name);
  const [targets, setTargets] = useState(item.target_languages);
  const detailsDirty =
    name.trim() !== item.name || [...targets].sort().join() !== [...item.target_languages].sort().join();
  const [requesting, setRequesting] = useState(false);
  const [comment, setComment] = useState("");

  const progress = useMemo(
    () =>
      Object.fromEntries(
        item.target_languages.map((code) => [code, languageProgress(fields, values, source, code)])
      ),
    [fields, values, source, item.target_languages]
  );
  const latestRequest = events.find((e) => e.event === "CHANGES_REQUESTED");

  function run(label: string, action: () => Promise<string | void>) {
    setError("");
    setNotice("");
    setBusy(label);
    startTransition(async () => {
      try {
        const message = await action();
        if (message) setNotice(message);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy("");
      }
    });
  }

  function afterUpload(result: { extracted: number; readError: string | null }) {
    setError("");
    setNotice(
      result.extracted
        ? "File uploaded and its text read into the field. Check it, then auto-translate."
        : result.readError
          ? `File uploaded. ${result.readError}`
          : "File uploaded."
    );
    router.refresh();
  }

  function switchLanguage(code: string) {
    if (code === activeLang) return;
    if (targetDirty.length > 0 && !confirm(`Discard unsaved ${languageName(activeLang)} changes?`)) return;
    const next = textMap(values, code);
    setActiveLang(code);
    setTargetBase(next);
    setTargetDraft(next);
  }

  function saveText(language: string, draft: TextMap, dirty: string[]) {
    run(`save-${language}`, async () => {
      await saveItemText({
        itemId: item.id,
        languageCode: language,
        changes: dirty.map((fieldId) => ({ fieldId, text: draft[fieldId] ?? "" })),
      });
      return `${languageName(language)} saved.`;
    });
  }

  const statusTone_ =
    item.status === "APPROVED" ? "good" : item.status === "CHANGES_REQUESTED" ? "bad" : item.status === "REVIEW" ? "info" : "neutral";
  const activeProgress = activeLang ? progress[activeLang] : undefined;

  return (
    <div className="space-y-4">
      {/* Workflow */}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={statusTone_}>{ITEM_STATUS_LABEL[item.status]}</Badge>
          <span className="text-xs text-[var(--hub-muted)]">
            {item.status === "APPROVED" && item.approved_by_name
              ? `Approved by ${item.approved_by_name} · ${formatStamp(item.approved_at)}`
              : item.status === "REVIEW" && item.submitted_by_name
                ? `Submitted by ${item.submitted_by_name} · ${formatStamp(item.submitted_at)}`
                : item.created_by_name
                  ? `Created by ${item.created_by_name}`
                  : null}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {canEdit && item.target_languages.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending || sourceDirty.length > 0}
                title={sourceDirty.length > 0 ? "Save the source text first" : undefined}
                onClick={() =>
                  run("translate", async () => {
                    const stats = await translateItem({ itemId: item.id });
                    return `${translateSummary(stats)}.`;
                  })
                }
              >
                {busy === "translate" ? "Translating…" : "Auto-translate"}
              </Button>
            ) : null}
            {canEdit && (item.status === "DRAFT" || item.status === "CHANGES_REQUESTED") ? (
              <Button
                type="button"
                disabled={pending || sourceDirty.length > 0 || targetDirty.length > 0}
                onClick={() =>
                  run("submit", async () => {
                    await submitItem(item.id);
                    return "Submitted for review. Approvers can now approve each language.";
                  })
                }
              >
                Submit for review
              </Button>
            ) : null}
            {canApprove && item.status !== "APPROVED" ? (
              <Button
                type="button"
                disabled={pending || sourceDirty.length > 0 || targetDirty.length > 0}
                onClick={() =>
                  run("approve", async () => {
                    await approveItem(item.id);
                    return `${itemLabel} approved in every language.`;
                  })
                }
              >
                Approve {itemLabel}
              </Button>
            ) : null}
            {canApprove && (item.status === "REVIEW" || item.status === "APPROVED") ? (
              <Button type="button" variant="secondary" disabled={pending} onClick={() => setRequesting((v) => !v)}>
                Request changes
              </Button>
            ) : null}
          </div>
        </div>
        {item.status === "CHANGES_REQUESTED" && latestRequest ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            <span className="font-semibold">{latestRequest.actor_name} asked for changes:</span>{" "}
            {latestRequest.comment}
          </div>
        ) : null}
        {item.status === "DRAFT" && !canApprove ? (
          <p className="text-xs text-[var(--hub-muted)]">
            Fill the source text, auto-translate, check each language, then submit for review.
          </p>
        ) : null}
        {requesting ? (
          <div className="space-y-2">
            <textarea
              className={textareaClass}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What needs to change? The editor sees this on the page."
              aria-label="Requested changes"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                disabled={pending || !comment.trim()}
                onClick={() =>
                  run("request", async () => {
                    await requestItemChanges({ itemId: item.id, comment });
                    setRequesting(false);
                    setComment("");
                    return "Sent back to the editor.";
                  })
                }
              >
                Send back
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRequesting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {notice ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {notice}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </Card>

      {/* Details */}
      <Card className="space-y-3 p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Name (for the list)" htmlFor="item-name">
            <input
              id="item-name"
              className={inputClass}
              value={name}
              disabled={!canEdit}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {canEdit ? (
            <FilterMultiSelect
              fullWidth
              label={`Written in ${languageName(source)} · translate into`}
              value={targets}
              onChange={setTargets}
              placeholder="No translation"
              options={languages
                .filter((l) => l.code !== source)
                .map((l) => ({ value: l.code, label: l.name }))}
            />
          ) : (
            <Field label={`Written in ${languageName(source)} · translate into`}>
              <p className="text-sm">
                {item.target_languages.map(languageName).join(", ") || "No translation"}
              </p>
            </Field>
          )}
        </div>
        {canEdit && detailsDirty ? (
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                run("details", async () => {
                  const next = await updateItemDetails(item.id, { name, target_languages: targets });
                  if (!next.target_languages.includes(activeLang)) {
                    switchLanguage(next.target_languages[0] ?? "");
                  }
                  return "Details saved.";
                })
              }
            >
              Save details
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setName(item.name);
                setTargets(item.target_languages);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}
      </Card>

      {/* Language tabs */}
      {item.target_languages.length > 0 ? (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)] uppercase">
            Compare with
          </span>
          {item.target_languages.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => switchLanguage(code)}
              aria-pressed={code === activeLang}
              className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${
                code === activeLang
                  ? "border-[var(--hub-accent)] bg-[var(--hub-accent-soft)] font-semibold"
                  : "border-[var(--hub-border)] hover:border-[var(--hub-border-strong)]"
              }`}
            >
              {languageName(code)}
              <LanguageChip code={code} progress={progress[code]} />
            </button>
          ))}
          {canApprove && activeProgress && !activeProgress.complete && activeProgress.total > 0 ? (
            <Button
              type="button"
              className="ml-auto"
              variant="secondary"
              disabled={pending || targetDirty.length > 0}
              title={targetDirty.length > 0 ? "Save your changes first" : undefined}
              onClick={() =>
                run("approve-lang", async () => {
                  const next = await approveItemLanguage({ itemId: item.id, languageCode: activeLang });
                  return next.status === "APPROVED"
                    ? `${languageName(activeLang)} approved. Every language is done, so the ${itemLabel} is approved.`
                    : `${languageName(activeLang)} approved.`;
                })
              }
            >
              Approve {languageName(activeLang)}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {/* Fields */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 border-b border-[var(--hub-border)] bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="hidden px-4 py-3 md:block">Field</div>
          <div className="px-4 py-3">Source · {languageName(source)}</div>
          <div className="hidden px-4 py-3 md:block">
            {activeLang ? `${languageName(activeLang)}` : "No target languages"}
          </div>
        </div>
        {fields.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--hub-muted)]">No fields yet. Add them on the Fields tab.</p>
        ) : (
          fields.map((field) => {
            const sourceValue = values.find((v) => v.field_id === field.id && v.language_code === source);
            const targetValue = values.find((v) => v.field_id === field.id && v.language_code === activeLang);
            return (
              <div
                key={field.id}
                className="grid grid-cols-1 gap-2 border-b border-[var(--hub-border)] px-4 py-3 last:border-b-0 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-0"
              >
                <div className="md:pr-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {field.label}
                    {field.required ? <span className="text-red-700"> *</span> : null}
                  </div>
                  <div className="text-[11px] text-[var(--hub-muted)]">
                    {field.translatable ? "Translated per language" : "Same in every language"}
                  </div>
                </div>
                <div className="md:pr-4">
                  <SourceInput
                    key={`${field.id}-${source}`}
                    itemId={item.id}
                    field={field}
                    language={source}
                    value={sourceValue}
                    text={sourceDraft[field.id] ?? ""}
                    canEdit={canEdit}
                    onText={(text) => setSourceDraft((prev) => ({ ...prev, [field.id]: text }))}
                    onUploaded={afterUpload}
                  />
                </div>
                <div>
                  {!activeLang ? null : !field.translatable ? (
                    <p className="pt-2 text-xs text-[var(--hub-muted)]">Uses the source value.</p>
                  ) : (
                    <div className="space-y-1">
                      <SourceInput
                        key={`${field.id}-${activeLang}`}
                        itemId={item.id}
                        field={field}
                        language={activeLang}
                        value={targetValue}
                        text={targetDraft[field.id] ?? ""}
                        canEdit={canEdit}
                        fileHint="Upload this country's own version only if it differs from the translation."
                        onText={(text) => setTargetDraft((prev) => ({ ...prev, [field.id]: text }))}
                        onUploaded={afterUpload}
                      />
                      <ValueBadges source={sourceValue} target={targetValue} />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        {canEdit ? (
          <div className="grid grid-cols-1 gap-2 border-t border-[var(--hub-border)] bg-slate-50 px-4 py-3 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="hidden md:block" />
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || sourceDirty.length === 0}
                onClick={() => saveText(source, sourceDraft, sourceDirty)}
              >
                {busy === `save-${source}` ? "Saving…" : `Save ${languageName(source)}`}
              </Button>
              {sourceDirty.length > 0 && item.target_languages.length > 0 ? (
                <p className="mt-1 text-xs text-amber-800">
                  Changing source text clears the approval on its translations.
                </p>
              ) : null}
            </div>
            <div>
              {activeLang ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || targetDirty.length === 0}
                  onClick={() => saveText(activeLang, targetDraft, targetDirty)}
                >
                  {busy === `save-${activeLang}` ? "Saving…" : `Save ${languageName(activeLang)}`}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      <CatalogActivity events={events} languageName={languageName} />

      {canEdit ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="text-red-700"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete ${item.item_code} and its files? This cannot be undone.`)) return;
              run("delete", async () => {
                await deleteItem(item.id);
                router.push(`/applications/${applicationId}/items`);
              });
            }}
          >
            Delete {itemLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const ACCEPT = "image/*,.pdf,.xlsx,.xls,.csv,.txt,.docx";

type UploadResult = { extracted: number; readError: string | null };

/**
 * One field in one language has one source: typed text, or a file (image, PDF, Excel, Word, text).
 * With a file, the text read from it stays editable so misread words can be fixed before translating.
 */
function SourceInput({
  itemId,
  field,
  language,
  value,
  text,
  canEdit,
  fileHint,
  onText,
  onUploaded,
}: {
  itemId: string;
  field: CatalogField;
  language: string;
  value?: CatalogValue;
  text: string;
  canEdit: boolean;
  fileHint?: string;
  onText: (text: string) => void;
  onUploaded: (result: UploadResult) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState<"text" | "file" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const hasFile = !!value?.file_path;
  const mode = choice ?? (hasFile ? "file" : "text");
  const href = hasFile && value ? `/api/catalog-files/${value.id}` : null;

  async function upload(file: File) {
    setError("");
    if (file.size > CATALOG_FILE_MAX_BYTES) {
      setError("Files can be up to 4 MB.");
      return;
    }
    if (text.trim() && !confirm(`Replace the typed ${field.label} with ${file.name}?`)) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.set("fieldId", field.id);
      body.set("languageCode", language);
      body.set("file", file);
      const res = await fetch(`/api/catalog/${itemId}/files`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Partial<UploadResult> & {
        error?: string;
        text?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      onText(data.text ?? "");
      onUploaded({ extracted: data.extracted ?? 0, readError: data.readError ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function switchToText() {
    if (!hasFile || !value) {
      setChoice("text");
      return;
    }
    if (!confirm(`Remove ${value.file_name}? The text read from it stays so you can edit it.`)) return;
    try {
      await deleteItemFile(value.id);
      setChoice("text");
      onUploaded({ extracted: 0, readError: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    }
  }

  const textBox = (
    <textarea
      className={`${textareaClass} [field-sizing:content] min-h-9 resize-y`}
      rows={1}
      value={text}
      disabled={!canEdit || uploading}
      aria-label={field.label}
      onChange={(e) => onText(e.target.value)}
    />
  );

  return (
    <div className="space-y-2">
      {canEdit ? (
        <div role="radiogroup" aria-label={`${field.label} source`} className="inline-flex rounded-lg border border-[var(--hub-border)] bg-white p-0.5 text-xs font-semibold">
          {(["text", "file"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              disabled={uploading}
              onClick={() => (option === "text" ? void switchToText() : setChoice("file"))}
              className={`rounded-md px-2.5 py-1 ${
                mode === option ? "bg-[var(--diy-red)] text-white" : "text-slate-600 hover:bg-[var(--diy-yellow-soft)]"
              }`}
            >
              {option === "text" ? "Text" : "File"}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "text" ? (
        textBox
      ) : (
        <div className="space-y-2">
          {href && value ? (
            <div className="flex flex-wrap items-center gap-3">
              {value.file_mime?.startsWith("image/") ? (
                // Signed storage link; Next image optimization cannot fetch it with the session.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={href}
                  alt={value.file_name ?? field.label}
                  className="h-20 w-20 rounded-md border border-[var(--hub-border)] object-cover"
                />
              ) : null}
              <div className="min-w-0 text-sm">
                <a href={href} target="_blank" rel="noreferrer" className="hub-accent-link break-all">
                  {value.file_name}
                </a>
                <div className="text-[11px] text-[var(--hub-muted)]">{formatBytes(value.file_size)}</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--hub-muted)]">
              {fileHint ?? "Image, PDF, Excel, Word, or text file, up to 4 MB."}
            </p>
          )}
          {canEdit ? (
            <>
              <input
                ref={input}
                type="file"
                className="hidden"
                accept={ACCEPT}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button type="button" variant="secondary" disabled={uploading} onClick={() => input.current?.click()}>
                {uploading ? "Uploading and reading…" : href ? "Replace file" : "Choose file"}
              </Button>
            </>
          ) : null}
          {href ? (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-[var(--hub-muted-strong)]">
                Text read from the file{canEdit ? ". Correct it if anything was misread." : ""}
              </div>
              {textBox}
            </div>
          ) : null}
        </div>
      )}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

function ValueBadges({ source, target }: { source?: CatalogValue; target?: CatalogValue }) {
  if (!source?.text_value.trim()) return null;
  if (!target?.text_value.trim()) return <Badge tone="neutral">Empty</Badge>;
  const stale = isStale(source, target);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge tone={statusTone(target.status)}>{target.status.replace("_", " ")}</Badge>
      {target.source_type === "MEMORY" ? <Badge tone="info">Reused approved translation</Badge> : null}
      {stale ? <Badge tone="warn">Source changed since</Badge> : null}
      {target.status === "APPROVED" && target.approved_by_name ? (
        <span className="text-[11px] text-[var(--hub-muted)]">by {target.approved_by_name}</span>
      ) : null}
    </div>
  );
}

const EVENT_TEXT: Record<CatalogEvent["event"], string> = {
  CREATED: "created it",
  EDITED: "edited",
  TRANSLATED: "auto-translated",
  SUBMITTED: "submitted it for review",
  LANGUAGE_APPROVED: "approved",
  APPROVED: "approved it",
  CHANGES_REQUESTED: "asked for changes",
  REOPENED: "moved it back to review",
  DELETED: "deleted it",
};

function CatalogActivity({
  events,
  languageName,
}: {
  events: CatalogEvent[];
  languageName: (code: string) => string;
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Activity</h2>
      {events.length === 0 ? (
        <p className="text-sm text-[var(--hub-muted)]">Nothing yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {events.map((event) => {
            const detail = event.detail ?? {};
            const fieldsChanged = Array.isArray(detail.fields) ? (detail.fields as string[]).join(", ") : "";
            const reason = typeof detail.reason === "string" ? detail.reason : "";
            const imported = typeof detail.import === "string" ? detail.import : "";
            const languagesDone = Array.isArray(detail.languages)
              ? (detail.languages as string[]).map((c) => c.toUpperCase()).join(", ")
              : "";
            return (
              <li key={event.id} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-semibold">{event.actor_name}</span>
                  <span>{EVENT_TEXT[event.event]}</span>
                  {event.language_code ? <span>{languageName(event.language_code)}</span> : null}
                  {fieldsChanged ? <span className="text-[var(--hub-muted-strong)]">· {fieldsChanged}</span> : null}
                  {languagesDone ? <span className="text-[var(--hub-muted-strong)]">· {languagesDone}</span> : null}
                  {imported ? <span className="text-[var(--hub-muted-strong)]">· from {imported}</span> : null}
                  <span className="text-xs text-[var(--hub-muted)]">· {formatStamp(event.created_at)}</span>
                </div>
                {reason ? <div className="text-xs text-[var(--hub-muted)]">{reason}</div> : null}
                {event.comment ? (
                  <blockquote className="mt-1 border-l-2 border-red-300 pl-2 text-sm text-slate-700">
                    {event.comment}
                  </blockquote>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
