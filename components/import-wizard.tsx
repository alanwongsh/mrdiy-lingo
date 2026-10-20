"use client";

import { errorMessage } from "@/lib/errors";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  confirmArticleImport,
  confirmStringImport,
  type CreatedImportArticle,
  type SkippedImportRow,
} from "@/lib/actions/import";
import type { AppAccess, Application, Language } from "@/lib/types";
import { MARKETS } from "@/lib/markets";
import { Badge, Button, Card, Field } from "@/components/ui";
import { FilterSelect } from "@/components/filter-select";
import { appKindLabel } from "@/lib/catalog";
import { LanguageMultiSelect } from "@/components/language-multi-select";

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

function articleSample(market: string): string[][] {
  return [
    ["title", "source_language", "market", "content_type", "status", "summary", "body"],
    [
      "Festive Value Campaign",
      "en",
      market,
      "GENERAL",
      "DRAFT",
      "A short description of the article.",
      "The article body in the source language.",
    ],
  ];
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="10" cy="10" r="7.25" />
      <path strokeLinecap="round" d="M10 9v4.5M10 6.5v.01" />
    </svg>
  );
}

/** The codes a file may use, folded away until asked for. */
function CodeList({
  title,
  note,
  items,
}: {
  title: string;
  note?: string;
  items: { code: string; name: string }[];
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-800">{title}</div>
      {note ? <p className="text-[11px] text-[var(--hub-muted)]">{note}</p> : null}
      <ul className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.code} className="flex items-baseline gap-2 text-xs">
            <code className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-slate-900 ring-1 ring-slate-200">
              {item.code}
            </code>
            <span className="text-slate-600">{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
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
  markets,
}: {
  importType: "STRING" | "CONTENT";
  languages: Language[];
  /** Markets this person may import into. */
  markets: { code: string; name: string }[];
}) {
  const rows =
    importType === "CONTENT"
      ? articleSample(markets[0]?.code ?? "MY")
      : stringSample(languages);
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
            A blank{" "}
            <span className="font-medium text-slate-800">content_type</span>{" "}
            becomes General. A type this app does not have yet is created on
            import.{" "}
            <span className="font-medium text-slate-800">status</span> is DRAFT or
            REVIEW; a blank status is DRAFT. Approving is chosen with the import button, not
            the file.
          </li>
          <li>
            <span className="font-medium text-slate-800">market</span> is required: a
            country code such as MY or TH.
            {markets.length === 1
              ? ` You only cover ${markets[0].code}, so a blank market becomes ${markets[0].code}.`
              : " Rows with a blank market, an unknown code, or a country outside your business unit are skipped."}
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
      {languages.length > 0 || (importType === "CONTENT" && markets.length > 0) ? (
        <details className="group rounded-md border border-slate-200 bg-white/70">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[var(--hub-accent)] select-none [&::-webkit-details-marker]:hidden">
            <InfoIcon />
            {importType === "CONTENT"
              ? "Valid codes for source_language and market"
              : "Valid language codes"}
            <span className="ml-auto text-slate-400 group-open:rotate-180" aria-hidden>
              ▾
            </span>
          </summary>
          <div className="grid gap-4 border-t border-slate-200 px-3 py-3 sm:grid-cols-2">
            {languages.length > 0 ? (
              <CodeList
                title={importType === "CONTENT" ? "source_language" : "Language columns"}
                items={languages.map((language) => ({ code: language.code, name: language.name }))}
              />
            ) : null}
            {importType === "CONTENT" && markets.length > 0 ? (
              <CodeList
                title="market"
                note="Only the countries of your business unit."
                items={markets}
              />
            ) : null}
          </div>
        </details>
      ) : null}
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
  applications: (Application & { access?: Pick<AppAccess, "markets" | "can_approve"> })[];
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
  const [receipt, setReceipt] = useState<{
    filename: string;
    imported: number;
    updated: number;
    unchanged: number;
    errors: number;
    skipped: SkippedImportRow[];
    created: CreatedImportArticle[];
    translated: number;
    typesCreated: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [translateLanguages, setTranslateLanguages] = useState<string[]>([]);
  const allowedMarkets = selectedApp?.access?.markets ?? null;
  const marketOptions = MARKETS.filter(
    (market) => allowedMarkets === null || allowedMarkets.includes(market.code)
  );
  const doneHref = applicationId
    ? importType === "CONTENT"
      ? `/applications/${applicationId}/articles`
      : `/applications/${applicationId}/translations`
    : "";

  /** Approvers choose: import as draft, or import and approve. */
  const canApproveImport = importType === "CONTENT" && Boolean(selectedApp?.access?.can_approve);
  const [importMode, setImportMode] = useState<"draft" | "approve" | null>(null);

  function runImport(approve = false) {
    if (!file || !applicationId || receipt) return;
    setImportMode(approve ? "approve" : "draft");
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
                approve,
              });
        setReceipt({
          filename: file.name,
          imported: res.imported,
          updated: res.updated,
          unchanged: res.unchanged,
          errors: res.errors,
          translated: res.translated,
          typesCreated:
            importType === "CONTENT" && "typesCreated" in res
              ? Number(res.typesCreated)
              : 0,
          skipped: "skipped" in res && Array.isArray(res.skipped) ? res.skipped : [],
          created: "created" in res && Array.isArray(res.created) ? res.created : [],
        });
      } catch (err) {
        setError(errorMessage(err, "Import failed"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        {!fixedApplicationId ? (
          <FilterSelect
            label="Application"
            fullWidth
            hideEmptyOption
            value={applicationId}
            placeholder="Choose an application"
            options={applications.map((app) => ({
              value: app.id,
              label: app.name,
              hint: appKindLabel(app),
            }))}
            onChange={(value) => {
              setApplicationId(value);
              setReceipt(null);
            }}
          />
        ) : null}

        <div className="text-sm text-[var(--hub-muted)]">
          Import type:{" "}
          <span className="font-medium text-[var(--hub-fg)]">
            {importType === "STRING"
              ? "Product string translations"
              : "Press articles"}
          </span>
        </div>

        <ImportFormatGuide
          importType={importType}
          languages={languages}
          markets={marketOptions.map((market) => ({ code: market.code, name: market.name }))}
        />

        <Field label="Upload Excel / CSV">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--hub-accent-fill)] px-3.5 text-sm font-semibold text-[var(--hub-on-accent)] shadow-sm transition hover:bg-[var(--hub-accent-fill-hover)]">
              Choose file
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
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
              label="Translate into"
              options={languages}
              selected={translateLanguages}
              onSelectedChange={setTranslateLanguages}
              showEditingSwitcher={false}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canApproveImport ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => runImport(false)}
                disabled={!file || pending || !!receipt}
              >
                {pending && importMode === "draft" ? "Importing…" : "Import as draft"}
              </Button>
              <Button
                type="button"
                onClick={() => runImport(true)}
                disabled={!file || pending || !!receipt}
              >
                {pending && importMode === "approve" ? "Importing…" : "Import and approve"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => runImport(false)} disabled={!file || pending || !!receipt}>
              {receipt
                ? "Imported"
                : pending
                  ? translateLanguages.length > 0
                    ? "Importing and translating…"
                    : "Importing…"
                  : translateLanguages.length > 0
                    ? "Import and translate"
                    : "Import"}
            </Button>
          )}
        </div>
        {canApproveImport ? (
          <p className="text-xs text-[var(--hub-muted)]">
            <span className="font-medium text-slate-700">Import as draft</span> saves every article
            and translation for review; nothing is approved.{" "}
            <span className="font-medium text-slate-700">Import and approve</span> approves each
            article and all its translations, from the file and from AI.
          </p>
        ) : null}
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
              {receipt.typesCreated > 0
                ? `, ${receipt.typesCreated} type${receipt.typesCreated === 1 ? "" : "s"} created`
                : ""}
              {receipt.errors > 0
                ? `, ${receipt.errors} error${receipt.errors === 1 ? "" : "s"}`
                : ""}
              .
            </p>
            {receipt.created.length > 0 ? (
              <div className="mt-2">
                <p className="text-xs font-semibold text-emerald-900">
                  New {receipt.created.length === 1 ? "article" : "articles"}:
                </p>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-xs">
                  {receipt.created.map((article) => (
                    <li key={article.id}>
                      <Link
                        href={`/applications/${applicationId}/articles/${article.id}`}
                        className="font-semibold text-emerald-950 underline-offset-2 hover:underline"
                      >
                        {article.title}
                      </Link>
                      <span className="text-emerald-800">
                        {" "}
                        · {article.market} · {article.status.charAt(0) + article.status.slice(1).toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {receipt.skipped.length > 0 ? (
              <div className="mt-2 rounded-md border border-amber-200 bg-white px-3 py-2">
                <p className="text-xs font-semibold text-amber-900">
                  {receipt.skipped.length} {receipt.skipped.length === 1 ? "row was" : "rows were"} not
                  imported. Fix {receipt.skipped.length === 1 ? "it" : "them"} in the file and import
                  {receipt.skipped.length === 1 ? " it" : " them"} again:
                </p>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-xs text-slate-700">
                  {receipt.skipped.map((item) => (
                    <li key={item.row}>
                      <span className="font-semibold">Row {item.row}</span>
                      {item.title ? ` (${item.title})` : ""}: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
    </div>
  );
}
