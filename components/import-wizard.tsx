"use client";

import { useMemo, useState, useTransition } from "react";
import {
  confirmArticleImport,
  confirmStringImport,
  previewArticleImport,
  previewStringImport,
} from "@/lib/actions/import";
import type { Application, Language } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  statusTone,
} from "@/components/ui";
import { LanguageMultiSelect } from "@/components/language-multi-select";

type PreviewResult = {
  items: Array<{
    action: string;
    error?: string;
    rowNumber: number;
    key?: string;
    namespace?: string;
    title?: string;
  }>;
  summary: {
    new: number;
    updated: number;
    unchanged: number;
    errors: number;
    total: number;
  };
};

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function ImportWizard({
  applications,
  languages,
  fixedApplicationId,
  lockedType,
}: {
  applications: Application[];
  languages: Language[];
  fixedApplicationId?: string;
  lockedType?: "STRING" | "CONTENT";
}) {
  const [applicationId, setApplicationId] = useState(
    fixedApplicationId ?? applications[0]?.id ?? ""
  );
  const selectedApp = useMemo(
    () => applications.find((a) => a.id === applicationId),
    [applications, applicationId]
  );
  const importType =
    lockedType ??
    (selectedApp?.model_type === "CONTENT" ? "CONTENT" : "STRING");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [translateLanguages, setTranslateLanguages] = useState<string[]>([]);

  function runPreview() {
    if (!file || !applicationId) return;
    setError("");
    setResult("");
    startTransition(async () => {
      try {
        const base64 = await fileToBase64(file);
        const data =
          importType === "STRING"
            ? await previewStringImport({
                applicationId,
                filename: file.name,
                base64,
              })
            : await previewArticleImport({
                applicationId,
                filename: file.name,
                base64,
              });
        setPreview(data as PreviewResult);
      } catch (err) {
        setPreview(null);
        setError(err instanceof Error ? err.message : "Preview failed");
      }
    });
  }

  function runConfirm() {
    if (!file || !applicationId) return;
    setError("");
    startTransition(async () => {
      try {
        const base64 = await fileToBase64(file);
        const res =
          importType === "STRING"
            ? await confirmStringImport({
                applicationId,
                filename: file.name,
                base64,
                translateLanguages,
              })
            : await confirmArticleImport({
                applicationId,
                filename: file.name,
                base64,
                translateLanguages,
              });
        const translateNote =
          res.translated > 0
            ? `, auto-translated ${res.translated} language version${res.translated === 1 ? "" : "s"}`
            : translateLanguages.length > 0
              ? ", no extra languages needed auto-translate (already in file or skipped)"
              : "";
        setResult(
          `Imported ${res.imported}, updated ${res.updated}, unchanged ${res.unchanged}, errors ${res.errors}${translateNote}`
        );
        runPreview();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        {!fixedApplicationId ? (
          <Field label="Application">
            <select
              className={inputClass}
              value={applicationId}
              onChange={(e) => {
                setApplicationId(e.target.value);
                setPreview(null);
              }}
            >
              {applications.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name} ({app.model_type})
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="text-sm text-[var(--hub-muted)]">
          Import type:{" "}
          <span className="font-medium text-[var(--hub-fg)]">
            {importType === "STRING"
              ? "Product string translations"
              : "Press articles"}
          </span>
        </div>

        <Field label="Upload Excel / CSV">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--hub-accent)] px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--hub-accent-hover)]">
              Choose file
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                  setResult("");
                }}
              />
            </label>
            <span
              className={`text-sm ${
                file ? "font-medium text-slate-900" : "text-[var(--hub-muted)]"
              }`}
            >
              {file ? file.name : "No file chosen"}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-[var(--hub-muted)]">
            Accepts .csv, .xlsx, or .xls
          </p>
        </Field>

        {languages.length > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <LanguageMultiSelect
              label="Also set as target languages + auto-translate"
              options={languages}
              selected={translateLanguages}
              onSelectedChange={setTranslateLanguages}
              showEditingSwitcher={false}
            />
            <p className="mt-2 text-xs text-slate-500">
              Selected languages become each article&apos;s target languages.
              File columns are kept; missing selected languages are
              auto-translated for new/updated rows.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={runPreview} disabled={!file || pending}>
            {pending ? "Working…" : "Validate & preview"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={runConfirm}
            disabled={!preview || pending}
          >
            {pending
              ? translateLanguages.length > 0
                ? "Importing & translating…"
                : "Importing…"
              : translateLanguages.length > 0
                ? `Confirm import + translate (${translateLanguages.length})`
                : "Confirm import"}
          </Button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {result ? <p className="text-sm text-emerald-800">{result}</p> : null}
      </Card>

      {preview ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ["New", preview.summary.new, "good"],
                ["Updated", preview.summary.updated, "info"],
                ["Unchanged", preview.summary.unchanged, "neutral"],
                ["Errors", preview.summary.errors, "bad"],
              ] as const
            ).map(([label, value, tone]) => (
              <Card key={label} className="p-4">
                <div className="text-xs text-[var(--hub-muted)] uppercase">
                  {label}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {value}
                </div>
                <Badge
                  tone={
                    tone === "good"
                      ? "good"
                      : tone === "info"
                        ? "info"
                        : tone === "bad"
                          ? "bad"
                          : "neutral"
                  }
                >
                  {label}
                </Badge>
              </Card>
            ))}
          </div>

          <Card className="overflow-x-auto">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Item</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.slice(0, 50).map((item) => (
                  <tr
                    key={`${item.rowNumber}-${item.key ?? item.title}`}
                    className="border-b border-[var(--hub-border)]"
                  >
                    <td className="px-4 py-2 tabular-nums">{item.rowNumber}</td>
                    <td className="px-4 py-2">
                      {item.key
                        ? `${item.namespace} / ${item.key}`
                        : item.title}
                      {item.error ? (
                        <span className="mt-0.5 block text-xs text-red-700">
                          {item.error}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={statusTone(item.action)}>{item.action}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
