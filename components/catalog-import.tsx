"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Papa from "papaparse";
import { type ItemImportResult } from "@/lib/catalog";
import type { CatalogField, Language } from "@/lib/types";
import { FilterSelect } from "@/components/filter-select";
import { Button, Card, Field } from "@/components/ui";

function sampleCsv(fields: CatalogField[], languages: Language[], source: string): string {
  const text = fields;
  const target = languages.find((l) => l.code !== source)?.code;
  const header = ["code", "name", "target_languages", ...text.map((f) => f.code)];
  const firstTranslatable = text.find((f) => f.translatable);
  if (target && firstTranslatable) header.push(`${target}_${firstTranslatable.code}`);
  const example = (n: number) =>
    header.map((column) => {
      if (column === "code") return `DEMO-${String(n).padStart(4, "0")}`;
      if (column === "name") return `Example ${n}`;
      if (column === "target_languages") return languages.filter((l) => l.code !== source).map((l) => l.code).join(" ");
      if (target && column.startsWith(`${target}_`)) return "";
      const field = text.find((f) => f.code === column);
      return field?.translatable === false ? "0000.00" : `${field?.label ?? column} text`;
    });
  return Papa.unparse([header, example(1), example(2)]);
}

export function CatalogImport({
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
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState(languages.find((l) => l.code === "en")?.code ?? languages[0]?.code ?? "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ItemImportResult | null>(null);
  const textFields = fields;

  function downloadSample() {
    const blob = new Blob([sampleCsv(fields, languages, source)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${itemLabel.toLowerCase().replace(/\s+/g, "-")}-import-sample.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("sourceLanguage", source);
      const res = await fetch(`/api/applications/${applicationId}/catalog-import`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as ItemImportResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="space-y-4 p-5">
        <Field label="CSV or Excel file" htmlFor="import-file">
          <input
            id="import-file"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="block text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <FilterSelect
          label={`New ${itemLabel}s are written in`}
          hideEmptyOption
          value={source}
          placeholder="Pick a language"
          options={languages.map((l) => ({ value: l.code, label: l.name }))}
          onChange={(next) => next && setSource(next)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!file || busy} onClick={upload}>
            {busy ? "Importing…" : "Import"}
          </Button>
          <Button type="button" variant="secondary" onClick={downloadSample}>
            Download sample
          </Button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {result ? (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p>
              {result.created} created · {result.updated} updated · {result.unchanged} unchanged
              {result.errors.length ? ` · ${result.errors.length} skipped` : ""}
            </p>
            {result.ignoredColumns.length ? (
              <p className="text-amber-900">
                Columns not matched to a field: {result.ignoredColumns.join(", ")}
              </p>
            ) : null}
            {result.errors.length ? (
              <ul className="list-disc pl-5 text-red-800">
                {result.errors.slice(0, 20).map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href={`/applications/${applicationId}/items`} className="hub-accent-link font-semibold">
              Open the list to auto-translate them
            </Link>
          </div>
        ) : null}
      </Card>
      <Card className="space-y-2 p-5 text-sm">
        <h2 className="font-semibold">Columns</h2>
        <ul className="space-y-1 text-[var(--hub-muted-strong)]">
          <li>
            <code>code</code> (required). An existing code updates that {itemLabel}; a new one creates a draft.
          </li>
          <li>
            <code>name</code>, <code>source_language</code>, <code>target_languages</code> (for example{" "}
            <code>ms zh-Hans</code>). Optional.
          </li>
          {textFields.map((f) => (
            <li key={f.id}>
              <code>{f.code}</code> — {f.label}
              {f.translatable ? (
                <>
                  , and <code>{"{language}"}_{f.code}</code> for a translation
                </>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--hub-muted)]">
          Files and images are uploaded on each {itemLabel}&apos;s page. Imported translations still need approval.
        </p>
      </Card>
    </div>
  );
}
