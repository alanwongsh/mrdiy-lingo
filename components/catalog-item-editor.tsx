"use client";

import { errorMessage } from "@/lib/errors";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addItemField,
  approveItem,
  approveItemLanguage,
  deleteItem,
  deleteItemFile,
  removeItemField,
  requestItemChanges,
  saveItemText,
  submitItem,
  translateItem,
  updateItemDetails,
} from "@/lib/actions/catalog";
import {
  formatBytes,
  formatStamp,
  hasValue,
  isStale,
  itemFields,
  ITEM_STATUS_LABEL,
  languageProgress,
  CATALOG_FILE_MAX_BYTES,
  type LanguageProgress,
} from "@/lib/catalog";
import type { CatalogEvent, CatalogField, CatalogItem, CatalogValue, Language } from "@/lib/types";
import { LanguageChip, translateSummary } from "@/components/catalog-item-list";
import { FilterMultiSelect, FilterSelect } from "@/components/filter-select";
import { CatalogActivity } from "@/components/catalog-activity";
import { LabelChipInput } from "@/components/label-chip-input";
import { Badge, Button, Card, Field, inputClass, statusTone, textareaClass } from "@/components/ui";
import { useTimeZone } from "@/components/time-zone";

type TextMap = Record<string, string>;

type Layout = "split" | "all";

const LAYOUT_STORAGE_KEY = "catalog-item-layout";

const LAYOUTS: { id: Layout; label: string; title: string }[] = [
  { id: "split", label: "Side by side", title: "Compare and edit two languages" },
  { id: "all", label: "All languages", title: "Line up every field across languages" },
];

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
  const timeZone = useTimeZone();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const languageName = (code: string) => languages.find((l) => l.code === code)?.name ?? code.toUpperCase();
  const source = item.source_language;
  // `fields` lists every known field name; the item shows only the ones added to it.
  const shown = useMemo(() => itemFields(fields, values, source), [fields, values, source]);

  const options = useMemo(
    () => [source, ...item.target_languages.filter((code) => code !== source)],
    [source, item.target_languages]
  );
  const optionLabels = options.map((code) => ({
    value: code,
    label: `${languageName(code)}${code === source ? " (source)" : ""}`,
  }));
  const canCompare = options.length > 1;

  // Unsaved text per language, so switching sides never drops what someone typed.
  const saved = useMemo(
    () => Object.fromEntries(options.map((code) => [code, textMap(values, code)])) as Record<string, TextMap>,
    [values, options]
  );
  const [base, setBase] = useState(saved);
  const [drafts, setDrafts] = useState(saved);
  if (base !== saved) {
    setBase(saved);
    setDrafts(
      Object.fromEntries(
        options.map((code) => [code, mergeDraft(drafts[code] ?? {}, base[code] ?? {}, saved[code] ?? {})])
      )
    );
  }
  const draftOf = (code: string) => drafts[code] ?? saved[code] ?? {};
  const dirtyOf = (code: string) => dirtyFields(draftOf(code), saved[code] ?? {});
  const sourceDirty = dirtyOf(source);
  const anyDirty = options.some((code) => dirtyOf(code).length > 0);

  const [layout, setLayout] = useState<Layout>("split");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (stored === "split" || stored === "all") setLayout(stored);
    } catch {
      // Storage can be blocked; the default layout still works.
    }
  }, []);
  function chooseLayout(next: Layout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      // Not remembered this time.
    }
  }
  const activeLayout: Layout = canCompare ? layout : "split";

  const [left, setLeft] = useState(source);
  const [right, setRight] = useState(item.target_languages[0] ?? source);
  const leftCode = options.includes(left) ? left : source;
  const rightPick = options.includes(right) ? right : (options.find((c) => c !== leftCode) ?? leftCode);
  const rightCode = rightPick === leftCode ? (options.find((c) => c !== leftCode) ?? leftCode) : rightPick;
  const panes = canCompare ? [leftCode, rightCode] : [source];

  function assignSide(index: number, code: string) {
    if (index === 0) {
      if (code === rightCode) setRight(leftCode);
      setLeft(code);
      return;
    }
    if (code === leftCode) setLeft(rightCode);
    setRight(code);
  }

  function editLanguage(code: string) {
    chooseLayout("split");
    setLeft(source);
    if (code !== source) setRight(code);
  }

  const [hidden, setHidden] = useState<string[]>([]);
  const shownCodes = options.filter((code) => !hidden.includes(code));

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
        setError(errorMessage(err, "Something went wrong"));
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

  function saveText(language: string) {
    const draft = draftOf(language);
    const dirty = dirtyOf(language);
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

  return (
    <div className="space-y-4">
      {/* Workflow */}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={statusTone_}>{ITEM_STATUS_LABEL[item.status]}</Badge>
          <span className="text-xs text-[var(--hub-muted)]">
            {item.status === "APPROVED" && item.approved_by_name
              ? `Approved by ${item.approved_by_name} · ${formatStamp(item.approved_at, timeZone)}`
              : item.status === "REVIEW" && item.submitted_by_name
                ? `Submitted by ${item.submitted_by_name} · ${formatStamp(item.submitted_at, timeZone)}`
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
                disabled={pending || anyDirty}
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
                disabled={pending || anyDirty}
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
                  await updateItemDetails(item.id, { name, target_languages: targets });
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

      {/* Fields */}
      <Card className="overflow-visible">
        {canEdit ? (
          <div className="space-y-1.5 border-b border-[var(--hub-border)] px-4 py-3">
            <div className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">Fields</div>
            <LabelChipInput
              chips={shown.map((f) => ({ key: f.id, label: f.label }))}
              suggestions={fields.map((f) => f.label)}
              disabled={pending}
              placeholder="Type a field name, then press Enter"
              ariaLabel="Add a field"
              onAdd={(label) =>
                run("add-field", async () => {
                  await addItemField({ itemId: item.id, label });
                })
              }
              onRemove={(chip) => {
                const filled = values.some((v) => v.field_id === chip.key && hasValue(v));
                if (
                  filled &&
                  !confirm(`Remove ${chip.label} from this ${itemLabel}? Its text and files in every language are deleted.`)
                ) {
                  return;
                }
                run("remove-field", async () => {
                  await removeItemField({ itemId: item.id, fieldId: chip.key });
                  return `${chip.label} removed.`;
                });
              }}
            />
          </div>
        ) : null}

        {canCompare ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
            <LayoutSwitch value={activeLayout} onChange={chooseLayout} />
            {activeLayout === "split" ? (
              <button
                type="button"
                className="hub-text-button text-xs"
                onClick={() => {
                  setLeft(rightCode);
                  setRight(leftCode);
                }}
              >
                Swap sides
              </button>
            ) : (
              <FilterMultiSelect
                value={shownCodes}
                onChange={(codes) => setHidden(options.filter((code) => !codes.includes(code)))}
                placeholder="Choose languages"
                options={optionLabels}
              />
            )}
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--hub-muted)]">
            {canEdit ? "No fields yet. Add one above." : "No fields yet."}
          </p>
        ) : activeLayout === "split" ? (
          <SplitView
            panes={panes}
            source={source}
            fields={shown}
            values={values}
            draftOf={draftOf}
            dirtyOf={dirtyOf}
            progress={progress}
            optionLabels={canCompare ? optionLabels : null}
            languageName={languageName}
            itemId={item.id}
            canEdit={canEdit}
            canApprove={canApprove}
            pending={pending}
            busy={busy}
            hasTargets={item.target_languages.length > 0}
            onSide={assignSide}
            onText={(code, fieldId, text) =>
              setDrafts((prev) => ({ ...prev, [code]: { ...(prev[code] ?? saved[code] ?? {}), [fieldId]: text } }))
            }
            onUploaded={afterUpload}
            onSave={saveText}
            onApprove={(code) =>
              run("approve-lang", async () => {
                const next = await approveItemLanguage({ itemId: item.id, languageCode: code });
                return next.status === "APPROVED"
                  ? `${languageName(code)} approved. Every language is done, so the ${itemLabel} is approved.`
                  : `${languageName(code)} approved.`;
              })
            }
          />
        ) : shownCodes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--hub-muted)]">Choose a language to show.</p>
        ) : (
          <AllLanguagesView
            codes={shownCodes}
            source={source}
            fields={shown}
            values={values}
            draftOf={draftOf}
            progress={progress}
            languageName={languageName}
            onEdit={editLanguage}
          />
        )}
      </Card>

      <CatalogActivity events={events} itemLabel={itemLabel} languageName={languageName} />

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

function LayoutSwitch({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  return (
    <div role="tablist" aria-label="View layout" className="flex flex-wrap gap-1 rounded-lg border border-[var(--hub-border)] bg-white p-1">
      {LAYOUTS.map((layout) => {
        const active = value === layout.id;
        return (
          <button
            key={layout.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={layout.title}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-[var(--hub-accent-ring)] ${
              active
                ? "bg-[var(--hub-accent-fill)] text-[var(--hub-on-accent)] shadow-sm"
                : "text-slate-600 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
            }`}
            onClick={() => onChange(layout.id)}
          >
            {layout.label}
          </button>
        );
      })}
    </div>
  );
}

type LanguageOption = { value: string; label: string };

/** Two languages next to each other, both editable. Each side picks its own language. */
function SplitView({
  panes,
  source,
  fields,
  values,
  draftOf,
  dirtyOf,
  progress,
  optionLabels,
  languageName,
  itemId,
  canEdit,
  canApprove,
  pending,
  busy,
  hasTargets,
  onSide,
  onText,
  onUploaded,
  onSave,
  onApprove,
}: {
  panes: string[];
  source: string;
  fields: CatalogField[];
  values: CatalogValue[];
  draftOf: (code: string) => TextMap;
  dirtyOf: (code: string) => string[];
  progress: Record<string, LanguageProgress>;
  /** Null when there is only the source language, so there is nothing to pick. */
  optionLabels: LanguageOption[] | null;
  languageName: (code: string) => string;
  itemId: string;
  canEdit: boolean;
  canApprove: boolean;
  pending: boolean;
  busy: string;
  hasTargets: boolean;
  onSide: (index: number, code: string) => void;
  onText: (code: string, fieldId: string, text: string) => void;
  onUploaded: (result: UploadResult) => void;
  onSave: (code: string) => void;
  onApprove: (code: string) => void;
}) {
  const columns = panes.length > 1 ? "md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]" : "md:grid-cols-[12rem_minmax(0,1fr)]";
  const nameOf = (code: string) => `${languageName(code)}${code === source ? " (source)" : ""}`;
  return (
    <>
      <div className={`grid grid-cols-1 gap-2 border-b border-[var(--hub-border)] bg-slate-50 px-4 py-3 md:gap-0 ${columns}`}>
        <div className="hidden pt-2 text-xs font-semibold tracking-wide text-slate-500 uppercase md:block">Field</div>
        {panes.map((code, index) => {
          const p = progress[code];
          return (
            <div key={`${index}-${code}`} className="flex flex-wrap items-center gap-2 md:pr-4">
              {optionLabels ? (
                <div className="w-full sm:w-56">
                  <FilterSelect
                    fullWidth
                    hideEmptyOption
                    ariaLabel={index === 0 ? "Left language" : "Right language"}
                    value={code}
                    placeholder="Select language"
                    options={optionLabels}
                    onChange={(next) => next && onSide(index, next)}
                  />
                </div>
              ) : (
                <span className="text-sm font-semibold text-slate-900">{nameOf(code)}</span>
              )}
              {code !== source ? <LanguageChip code={code} progress={p} /> : null}
              {canApprove && code !== source && p && !p.complete && p.total > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || dirtyOf(code).length > 0}
                  title={dirtyOf(code).length > 0 ? "Save your changes first" : undefined}
                  onClick={() => onApprove(code)}
                >
                  Approve {languageName(code)}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      {fields.map((field) => {
        const sourceValue = values.find((v) => v.field_id === field.id && v.language_code === source);
        return (
          <div
            key={field.id}
            className={`grid grid-cols-1 gap-3 border-b border-[var(--hub-border)] px-4 py-3 last:border-b-0 md:gap-0 ${columns}`}
          >
            <div className="md:pr-4">
              <div className="text-sm font-semibold text-slate-900">{field.label}</div>
              <div className="text-[11px] text-[var(--hub-muted)]">
                {field.translatable ? "Translated per language" : "Same in every language"}
              </div>
            </div>
            {panes.map((code, index) => {
              const value = values.find((v) => v.field_id === field.id && v.language_code === code);
              return (
                <div key={`${index}-${code}`} className="min-w-0 md:pr-4 last:md:pr-0">
                  {panes.length > 1 ? (
                    <div className="mb-1 text-[11px] font-semibold text-[var(--hub-muted-strong)] md:hidden">
                      {nameOf(code)}
                    </div>
                  ) : null}
                  {code !== source && !field.translatable ? (
                    <p className="pt-2 text-xs text-[var(--hub-muted)]">Uses the source value.</p>
                  ) : (
                    <div className="space-y-1">
                      <SourceInput
                        key={`${field.id}-${code}`}
                        itemId={itemId}
                        field={field}
                        language={code}
                        value={value}
                        text={draftOf(code)[field.id] ?? ""}
                        canEdit={canEdit}
                        fileHint={
                          code === source
                            ? undefined
                            : "Upload this country's own version only if it differs from the translation."
                        }
                        onText={(text) => onText(code, field.id, text)}
                        onUploaded={onUploaded}
                      />
                      {code !== source ? <ValueBadges source={sourceValue} target={value} /> : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {canEdit ? (
        <div className={`grid grid-cols-1 gap-2 border-t border-[var(--hub-border)] bg-slate-50 px-4 py-3 md:gap-0 ${columns}`}>
          <div className="hidden md:block" />
          {panes.map((code, index) => {
            const dirty = dirtyOf(code);
            return (
              <div key={`${index}-${code}`} className="md:pr-4">
                <Button type="button" variant="secondary" disabled={pending || dirty.length === 0} onClick={() => onSave(code)}>
                  {busy === `save-${code}` ? "Saving…" : `Save ${languageName(code)}`}
                </Button>
                {code === source && dirty.length > 0 && hasTargets ? (
                  <p className="mt-1 text-xs text-amber-800">
                    Changing source text clears the approval on its translations.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

/** Every chosen language as a column, one row per field. Read only; Edit opens a language side by side. */
function AllLanguagesView({
  codes,
  source,
  fields,
  values,
  draftOf,
  progress,
  languageName,
  onEdit,
}: {
  codes: string[];
  source: string;
  fields: CatalogField[];
  values: CatalogValue[];
  draftOf: (code: string) => TextMap;
  progress: Record<string, LanguageProgress>;
  languageName: (code: string) => string;
  onEdit: (code: string) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <div
        className="grid"
        style={{ gridTemplateColumns: `10rem repeat(${codes.length}, minmax(16rem, 1fr))`, minWidth: "100%" }}
      >
        <div className="sticky left-0 z-20 border-r border-b border-[var(--hub-border)] bg-slate-50" />
        {codes.map((code) => (
          <div
            key={code}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-l border-[var(--hub-border)] bg-slate-50 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {languageName(code)}
                {code === source ? " (source)" : ""}
              </h3>
              {code !== source ? <LanguageChip code={code} progress={progress[code]} /> : null}
            </div>
            <button type="button" className="hub-text-button text-xs" onClick={() => onEdit(code)}>
              Edit
            </button>
          </div>
        ))}
        {fields.map((field) => (
          <Fragment key={field.id}>
            <div className="sticky left-0 z-10 border-r border-b border-[var(--hub-border)] bg-[var(--hub-panel)] px-3 py-3 text-xs font-semibold tracking-wide text-[var(--hub-muted)] uppercase">
              {field.label}
            </div>
            {codes.map((code) => {
              const sourceValue = values.find((v) => v.field_id === field.id && v.language_code === source);
              const value = values.find((v) => v.field_id === field.id && v.language_code === code);
              const text = draftOf(code)[field.id] ?? value?.text_value ?? "";
              return (
                <div key={`${field.id}-${code}`} className="min-w-0 space-y-1.5 border-b border-l border-[var(--hub-border)] px-3 py-3">
                  {code !== source && !field.translatable ? (
                    <p className="text-xs text-[var(--hub-muted)]">Uses the source value.</p>
                  ) : (
                    <>
                      {value?.file_path ? (
                        <a
                          href={`/api/catalog-files/${value.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hub-accent-link block text-xs break-all"
                        >
                          {value.file_name}
                        </a>
                      ) : null}
                      {text.trim() ? (
                        <p className="text-sm whitespace-pre-wrap text-slate-800">{text}</p>
                      ) : (
                        <p className="text-xs text-[var(--hub-muted)]">Empty</p>
                      )}
                      {code !== source ? <ValueBadges source={sourceValue} target={value} /> : null}
                    </>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
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
      setError(errorMessage(err, "Upload failed"));
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
      setError(errorMessage(err, "Remove failed"));
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
                mode === option ? "bg-[var(--hub-accent-fill)] text-[var(--hub-on-accent)]" : "text-slate-600 hover:bg-[var(--diy-yellow-soft)]"
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
