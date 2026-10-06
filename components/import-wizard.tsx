"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
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

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function sampleCodes(languages: Language[]) {
  const codes = languages.map((language) => language.code.trim()).filter(Boolean);
  const source =
    codes.find((code) => code.toLowerCase() === "en") ?? codes[0] ?? "en";
  const targets = codes
    .filter((code) => code.toLowerCase() !== source.toLowerCase())
    .slice(0, 2);
  return { source, targets: targets.length > 0 ? targets : ["ms"] };
}

function articleSample(): string[][] {
  return [
    ["title", "source_language", "content_type", "status", "summary", "body"],
    [
      "Festive Value Campaign",
      "en",
      "ARTICLE",
      "DRAFT",
      "A short description of the article.",
      "The article body in the source language.",
    ],
  ];
}

function stringSample(languages: Language[]): string[][] {
  const { source, targets } = sampleCodes(languages);
  return [
    ["namespace", "key", source, ...targets],
    ["common", "home.greeting", "Welcome", ...targets.map(() => "")],
  ];
}

function ImportFormatGuide({
  importType,
  languages,
}: {
  importType: "STRING" | "CONTENT";
  languages: Language[];
}) {
  const rows =
    importType === "CONTENT" ? articleSample() : stringSample(languages);
  const { source, targets } = sampleCodes(languages);
  const filename =
    importType === "CONTENT" ? "article-import-sample.csv" : "string-import-sample.csv";

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">File format</h2>
        <Button
          type="button"
          variant="secondary"
          onClick={() => downloadCsv(filename, rows)}
        >
          Download sample CSV
        </Button>
      </div>
      {importType === "CONTENT" ? (
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
          <li>Row 1 is the header. Each following row is one article.</li>
          <li>
            <span className="font-medium text-slate-800">title</span> and{" "}
            <span className="font-medium text-slate-800">source_language</span>{" "}
            are required. <span className="font-medium text-slate-800">summary</span>{" "}
            and <span className="font-medium text-slate-800">body</span> are the
            source text in that language. A blank source language becomes en.
          </li>
          <li>
            <span className="font-medium text-slate-800">content_type</span> is
            ARTICLE, NEWS, or ANNOUNCEMENT.{" "}
            <span className="font-medium text-slate-800">status</span> is DRAFT,
            TRANSLATING, REVIEW, APPROVED, or PUBLISHED.
          </li>
        </ul>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
          <li>Row 1 is the header. Each following row is one string.</li>
          <li>
            <span className="font-medium text-slate-800">namespace</span> and{" "}
            <span className="font-medium text-slate-800">key</span> are required.
            Every other column name is a language code, such as {source}
            {targets.length > 0 ? ` or ${targets.join(", ")}` : ""}.
          </li>
          <li>
            The {source} column is the source text. Leave a language cell blank
            to auto-translate it from the picker below.
          </li>
        </ul>
      )}
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              {rows[0].map((header) => (
                <th key={header} className="px-2 py-1.5 font-semibold whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {rows[1].map((cell, index) => (
                <td
                  key={`${rows[0][index]}-${index}`}
                  className="px-2 py-1.5 whitespace-nowrap text-slate-600"
                >
                  {cell || "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const [receipt, setReceipt] = useState<{
    filename: string;
    imported: number;
    updated: number;
    unchanged: number;
    errors: number;
    translated: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [translateLanguages, setTranslateLanguages] = useState<string[]>([]);
  const doneHref = applicationId
    ? importType === "CONTENT"
      ? `/applications/${applicationId}/articles`
      : `/applications/${applicationId}/translations`
    : "";

  function runPreview() {
    if (!file || !applicationId) return;
    setError("");
    setReceipt(null);
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
        setReceipt({
          filename: file.name,
          imported: res.imported,
          updated: res.updated,
          unchanged: res.unchanged,
          errors: res.errors,
          translated: res.translated,
        });
        const refreshed =
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
        setPreview(refreshed as PreviewResult);
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
                setReceipt(null);
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

        <ImportFormatGuide importType={importType} languages={languages} />

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
                  setReceipt(null);
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
            disabled={!preview || pending || !!receipt}
          >
            {receipt
              ? "Imported"
              : pending
                ? translateLanguages.length > 0
                  ? "Importing & translating…"
                  : "Importing…"
                : translateLanguages.length > 0
                  ? `Confirm import + translate (${translateLanguages.length})`
                  : "Confirm import"}
          </Button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {receipt ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="good">Imported</Badge>
              <span className="text-sm font-semibold text-emerald-950">
                {receipt.filename}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-emerald-900">
              {receipt.imported} new, {receipt.updated} updated, {receipt.unchanged}{" "}
              unchanged
              {receipt.translated > 0
                ? `, ${receipt.translated} language version${receipt.translated === 1 ? "" : "s"} translated`
                : ""}
              {receipt.errors > 0
                ? `, ${receipt.errors} error${receipt.errors === 1 ? "" : "s"}`
                : ""}
              .
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              This file is done. Choose another file if you need to import again.
            </p>
            {doneHref ? (
              <Link
                href={doneHref}
                className="mt-2 inline-block text-sm font-semibold text-emerald-950 underline"
              >
                {importType === "CONTENT" ? "View articles" : "View translations"}
              </Link>
            ) : null}
          </div>
        ) : null}
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
