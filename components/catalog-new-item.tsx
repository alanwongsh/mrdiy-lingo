"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createItem } from "@/lib/actions/catalog";
import { CATALOG_FILE_MAX_BYTES, formatBytes } from "@/lib/catalog";
import type { CatalogField, Language } from "@/lib/types";
import { FilterMultiSelect, FilterSelect } from "@/components/filter-select";
import { Button, Card, Field, inputClass, textareaClass } from "@/components/ui";

const ACCEPT = "image/*,.pdf,.xlsx,.xls,.csv,.txt,.docx";

export function CatalogNewItem({
  applicationId,
  itemLabel,
  fields,
  languages,
}: {
  applicationId: string;
  itemLabel: string;
  fields: CatalogField[];
  languages: Language[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const defaultSource = languages.find((l) => l.code === "en")?.code ?? languages[0]?.code ?? "en";
  const [source, setSource] = useState(defaultSource);
  const [targets, setTargets] = useState<string[]>(() =>
    languages.map((l) => l.code).filter((c) => c !== defaultSource)
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [modes, setModes] = useState<Record<string, "text" | "file">>({});
  const modeOf = (fieldId: string) => modes[fieldId] ?? "text";

  function pickFile(fieldId: string, file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.size > CATALOG_FILE_MAX_BYTES) {
      setError(`${file.name} is over 4 MB.`);
      return;
    }
    setFiles((prev) => ({ ...prev, [fieldId]: file }));
  }

  /** Files go up after the record exists; each one's text is read into its field if that is empty. */
  async function uploadFiles(itemId: string): Promise<string[]> {
    const failed: string[] = [];
    const entries = Object.entries(files).filter(([fieldId]) => modeOf(fieldId) === "file");
    for (let i = 0; i < entries.length; i += 1) {
      const [fieldId, file] = entries[i];
      setProgress(`Uploading and reading ${file.name} (${i + 1} of ${entries.length})…`);
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
    setProgress("");
    return failed;
  }

  return (
    <Card className="max-w-3xl p-5">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          startTransition(async () => {
            try {
              const item = await createItem({
                applicationId,
                item_code: code,
                name,
                source_language: source,
                target_languages: targets,
                // One source per field: typed text only for fields left on Text.
                values: Object.fromEntries(
                  Object.entries(values).filter(([fieldId]) => modeOf(fieldId) === "text")
                ),
              });
              const failed = await uploadFiles(item.id);
              if (failed.length > 0) {
                setCreatedId(item.id);
                setError(`${itemLabel} created, but some files did not upload. ${failed.join(" · ")}`);
                return;
              }
              router.push(`/applications/${applicationId}/items/${item.id}`);
            } catch (err) {
              setProgress("");
              setError(err instanceof Error ? err.message : "Failed to create");
            }
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${itemLabel} code`} htmlFor="item-code" required>
            <input
              id="item-code"
              className={`${inputClass} font-mono`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="For example, 1234567"
              required
              autoFocus
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

        {fields.length > 0 ? (
          <div className="space-y-4 border-t border-[var(--hub-border)] pt-4">
            <p className="text-xs text-[var(--hub-muted)]">
              Each field takes typed text or one file (image, PDF, Excel, Word, or text). The text in a
              file is read in for you to check before translating.
            </p>
            {fields.map((field) => {
              const file = files[field.id];
              const inputId = `file-${field.id}`;
              return (
                <Field
                  key={field.id}
                  label={field.label}
                  required={field.required}
                  htmlFor={`field-${field.id}`}
                >
                  <div role="radiogroup" aria-label={`${field.label} source`} className="inline-flex w-fit rounded-lg border border-[var(--hub-border)] bg-white p-0.5 text-xs font-semibold">
                    {(["text", "file"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={modeOf(field.id) === option}
                        onClick={() => setModes((prev) => ({ ...prev, [field.id]: option }))}
                        className={`rounded-md px-2.5 py-1 ${
                          modeOf(field.id) === option
                            ? "bg-[var(--diy-red)] text-white"
                            : "text-slate-600 hover:bg-[var(--diy-yellow-soft)]"
                        }`}
                      >
                        {option === "text" ? "Text" : "File"}
                      </button>
                    ))}
                  </div>
                  {modeOf(field.id) === "text" ? (
                  <textarea
                    id={`field-${field.id}`}
                    className={`${textareaClass} [field-sizing:content] min-h-9 resize-y`}
                    rows={1}
                    value={values[field.id] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  />
                  ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      id={inputId}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        pickFile(field.id, e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <label
                      htmlFor={inputId}
                      className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm hover:border-[var(--hub-accent)] hover:text-[var(--hub-accent)]"
                    >
                      {file ? "Change file" : "Choose file"}
                    </label>
                    {file ? (
                      <>
                        <span className="break-all text-slate-700">{file.name}</span>
                        <span className="text-xs text-[var(--hub-muted)]">{formatBytes(file.size)}</span>
                        <button
                          type="button"
                          className="hub-text-button text-xs"
                          onClick={() =>
                            setFiles((prev) => {
                              const next = { ...prev };
                              delete next[field.id];
                              return next;
                            })
                          }
                        >
                          Remove
                        </button>
                      </>
                    ) : null}
                  </div>
                  )}
                </Field>
              );
            })}
          </div>
        ) : null}

        {progress ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{progress}</p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {createdId ? (
          <Link href={`/applications/${applicationId}/items/${createdId}`} className="hub-accent-link text-sm font-semibold">
            Open the {itemLabel} to retry the upload
          </Link>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : `Create ${itemLabel}`}
          </Button>
        )}
      </form>
    </Card>
  );
}
