"use client";

import { errorMessage } from "@/lib/errors";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createItem, translateItem } from "@/lib/actions/catalog";
import { CATALOG_FILE_MAX_BYTES, formatBytes } from "@/lib/catalog";
import type { CatalogField, Language } from "@/lib/types";
import { FilterMultiSelect, FilterSelect } from "@/components/filter-select";
import { LabelChipInput } from "@/components/label-chip-input";
import { Button, Card, Field, inputClass, textareaClass } from "@/components/ui";

const ACCEPT = "image/*,.pdf,.xlsx,.xls,.csv,.txt,.docx";

type Entry = {
  key: string;
  label: string;
  mode: "text" | "file";
  text: string;
  file?: File;
};

export function CatalogNewItem({
  applicationId,
  itemLabel,
  fields,
  languages,
  suggestedCode,
}: {
  applicationId: string;
  itemLabel: string;
  /** Prefilled code. The person can keep it or type their own. */
  suggestedCode: string;
  /** Known field names, offered as suggestions. */
  fields: CatalogField[];
  languages: Language[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [code, setCode] = useState(suggestedCode);
  const [name, setName] = useState("");
  const defaultSource = languages.find((l) => l.code === "en")?.code ?? languages[0]?.code ?? "en";
  const [source, setSource] = useState(defaultSource);
  const [targets, setTargets] = useState<string[]>(() =>
    languages.map((l) => l.code).filter((c) => c !== defaultSource)
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const nextKey = useRef(0);
  const [intent, setIntent] = useState<"translate" | "draft">("draft");

  function addEntry(label: string) {
    nextKey.current += 1;
    setEntries((prev) => [...prev, { key: `entry-${nextKey.current}`, label, mode: "text", text: "" }]);
  }

  function updateEntry(key: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function pickFile(key: string, file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.size > CATALOG_FILE_MAX_BYTES) {
      setError(`${file.name} is over 4 MB.`);
      return;
    }
    updateEntry(key, { file });
  }

  /** Files go up after the record exists; each one's text is read into its field. */
  async function uploadFiles(itemId: string, fieldIds: string[]): Promise<string[]> {
    const failed: string[] = [];
    const uploads = entries
      .map((entry, i) => ({ entry, fieldId: fieldIds[i] }))
      .filter(({ entry, fieldId }) => entry.mode === "file" && entry.file && fieldId);
    for (let i = 0; i < uploads.length; i += 1) {
      const { entry, fieldId } = uploads[i];
      const file = entry.file as File;
      setProgress(`Uploading and reading ${file.name} (${i + 1} of ${uploads.length})…`);
      const body = new FormData();
      body.set("fieldId", fieldId);
      body.set("languageCode", source);
      body.set("file", file);
      const res = await fetch(`/api/catalog/${itemId}/files`, { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        failed.push(`${file.name}: ${data.error ?? "upload failed"}`);
      }
    }
    return failed;
  }

  return (
    <Card className="max-w-3xl p-5">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const nextIntent = submitter?.dataset.intent === "translate" ? "translate" : "draft";
          setIntent(nextIntent);
          const translate = nextIntent === "translate" && targets.length > 0;
          startTransition(async () => {
            let itemId: string | null = null;
            try {
              const created = await createItem({
                applicationId,
                item_code: code,
                name,
                source_language: source,
                target_languages: targets,
                // One source per field: typed text only for fields left on Text.
                fields: entries.map((entry) => ({
                  label: entry.label,
                  text: entry.mode === "text" ? entry.text : "",
                })),
              });
              itemId = created.item.id;
              const failed = await uploadFiles(itemId, created.fieldIds);
              if (failed.length > 0) {
                setProgress("");
                setCreatedId(itemId);
                setError(`${itemLabel} created, but some files did not upload. ${failed.join(" · ")}`);
                return;
              }
              if (translate) {
                setProgress("Translating…");
                await translateItem({ itemId });
              }
              router.push(`/applications/${applicationId}/items/${itemId}`);
            } catch (err) {
              setProgress("");
              if (itemId) {
                setCreatedId(itemId);
                setError(`${itemLabel} created, but translation did not finish. ${errorMessage(err, "")}`.trim());
              } else {
                setError(errorMessage(err, "Failed to create"));
              }
            }
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${itemLabel} code`} htmlFor="item-code">
            <input
              id="item-code"
              className={`${inputClass} font-mono`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Generated when left blank"
            />
          </Field>
          <Field label="Name (for the list)" htmlFor="item-name">
            <input
              id="item-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-3 border-t border-[var(--hub-border)] pt-4">
          <div className="space-y-1.5">
            <div className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">Fields</div>
            <LabelChipInput
              chips={entries.map((e) => ({ key: e.key, label: e.label }))}
              suggestions={fields.map((f) => f.label)}
              onAdd={addEntry}
              onRemove={(chip) => setEntries((prev) => prev.filter((e) => e.key !== chip.key))}
              disabled={pending}
              placeholder="Type a field name, such as Product name, then press Enter"
              ariaLabel="Add a field"
            />
            <p className="text-xs text-[var(--hub-muted)]">
              Pick a field used before or type a new one. Each field takes typed text or one file (image,
              PDF, Excel, Word, or text); the text in a file is read in for you to check.
            </p>
          </div>

          {entries.map((entry) => {
            const inputId = `file-${entry.key}`;
            return (
              <div key={entry.key} className="space-y-2 rounded-lg border border-[var(--hub-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`text-${entry.key}`} className="text-sm font-semibold text-slate-900">
                    {entry.label}
                  </label>
                  <div
                    role="radiogroup"
                    aria-label={`${entry.label} source`}
                    className="inline-flex w-fit rounded-lg border border-[var(--hub-border)] bg-white p-0.5 text-xs font-semibold"
                  >
                    {(["text", "file"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={entry.mode === option}
                        onClick={() => updateEntry(entry.key, { mode: option })}
                        className={`rounded-md px-2.5 py-1 ${
                          entry.mode === option
                            ? "bg-[var(--hub-accent-fill)] text-[var(--hub-on-accent)]"
                            : "text-slate-600 hover:bg-[var(--diy-yellow-soft)]"
                        }`}
                      >
                        {option === "text" ? "Text" : "File"}
                      </button>
                    ))}
                  </div>
                </div>
                {entry.mode === "text" ? (
                  <textarea
                    id={`text-${entry.key}`}
                    className={`${textareaClass} [field-sizing:content] min-h-9 resize-y`}
                    rows={1}
                    value={entry.text}
                    onChange={(e) => updateEntry(entry.key, { text: e.target.value })}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      id={inputId}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        pickFile(entry.key, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <label
                      htmlFor={inputId}
                      className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm hover:border-[var(--hub-accent)] hover:text-[var(--hub-accent)]"
                    >
                      {entry.file ? "Change file" : "Choose file"}
                    </label>
                    {entry.file ? (
                      <>
                        <span className="break-all text-slate-700">{entry.file.name}</span>
                        <span className="text-xs text-[var(--hub-muted)]">{formatBytes(entry.file.size)}</span>
                        <button
                          type="button"
                          className="hub-text-button text-xs"
                          onClick={() => updateEntry(entry.key, { file: undefined })}
                        >
                          Remove
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 border-t border-[var(--hub-border)] pt-4 sm:grid-cols-2">
          <FilterSelect
            label="Written in"
            fullWidth
            hideEmptyOption
            value={source}
            placeholder="Pick a language"
            options={languages.map((l) => ({ value: l.code, label: l.name }))}
            onChange={(next) => {
              if (!next || next === source) return;
              setSource(next);
              setTargets((prev) => [...prev.filter((c) => c !== next), source]);
            }}
          />
          <FilterMultiSelect
            fullWidth
            label="Translate into"
            value={targets}
            onChange={setTargets}
            placeholder="No translation"
            options={languages
              .filter((l) => l.code !== source)
              .map((l) => ({ value: l.code, label: l.name }))}
          />
        </div>

        {progress ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{progress}</p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {createdId ? (
          <Link href={`/applications/${applicationId}/items/${createdId}`} className="hub-accent-link text-sm font-semibold">
            Open the {itemLabel} to finish
          </Link>
        ) : (
          <div className="flex flex-wrap gap-2">
            {targets.length > 0 ? (
              <Button
                type="submit"
                disabled={pending || entries.length === 0}
                title={entries.length === 0 ? "Add a field first" : undefined}
                data-intent="translate"
              >
                {pending && intent === "translate" ? "Working…" : "Create and translate"}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant={targets.length > 0 ? "secondary" : "primary"}
              disabled={pending}
              data-intent="draft"
            >
              {pending && intent === "draft" ? "Creating…" : "Save as draft"}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
