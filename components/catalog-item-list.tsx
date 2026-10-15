"use client";

import { errorMessage } from "@/lib/errors";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { translateItems, type ItemListItem, type TranslateStats } from "@/lib/actions/catalog";
import { formatStamp, ITEM_STATUS_LABEL, type LanguageProgress } from "@/lib/catalog";
import { Badge, Button, Card, statusTone } from "@/components/ui";
import { useTimeZone } from "@/components/time-zone";

export function translateSummary(stats: TranslateStats): string {
  const parts = [`${stats.written} value${stats.written === 1 ? "" : "s"} written`];
  parts.push(`${stats.providerCalls} sent to the translator`);
  if (stats.fromMemory) parts.push(`${stats.fromMemory} reused from approved translations`);
  if (stats.fromBatch) parts.push(`${stats.fromBatch} repeated text translated once`);
  if (stats.kept) parts.push(`${stats.kept} kept (already edited or approved)`);
  if (stats.failed) parts.push(`${stats.failed} failed`);
  return parts.join(" · ");
}

export function LanguageChip({ code, progress }: { code: string; progress: LanguageProgress | undefined }) {
  const p = progress ?? { total: 0, approved: 0, missing: 0, stale: 0, complete: false };
  const tone = p.complete
    ? "good"
    : p.stale > 0
      ? "warn"
      : p.missing === p.total
        ? "neutral"
        : "info";
  const title = p.total === 0
    ? "No source text to translate yet"
    : `${p.approved} of ${p.total} approved${p.missing ? `, ${p.missing} empty` : ""}${p.stale ? `, ${p.stale} out of date` : ""}`;
  return (
    <span title={title}>
      <Badge tone={tone}>
        {code.toUpperCase()} {p.total ? `${p.approved}/${p.total}` : "–"}
      </Badge>
    </span>
  );
}

export function CatalogItemList({
  applicationId,
  items,
  itemLabel,
  canEdit,
}: {
  applicationId: string;
  items: ItemListItem[];
  itemLabel: string;
  canEdit: boolean;
}) {
  const timeZone = useTimeZone();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const allSelected = items.length > 0 && selected.length === items.length;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function translateSelected() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const stats = await translateItems({ applicationId, itemIds: selected });
        setMessage(`${stats.items} ${itemLabel}${stats.items === 1 ? "" : "s"} translated. ${translateSummary(stats)}.`);
        setSelected([]);
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Translate failed"));
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && selected.length > 0 ? (
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <Button type="button" disabled={pending || selected.length > 50} onClick={translateSelected}>
            {pending ? "Translating…" : "Auto-translate selected"}
          </Button>
          {selected.length > 50 ? (
            <span className="text-xs text-[var(--hub-muted)]">Pick up to 50 at a time.</span>
          ) : (
            <span className="text-xs text-[var(--hub-muted)]">
              Fills empty or out-of-date languages. Approved and hand-edited text is kept.
            </span>
          )}
        </Card>
      ) : null}
      {pending ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Translating. Text already approved elsewhere is reused instead of translated again…
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <Card className="overflow-x-auto">
        <table className="hub-table">
          <thead>
            <tr>
              {canEdit ? (
                <th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : items.map((i) => i.id))}
                  />
                </th>
              ) : null}
              <th>{itemLabel}</th>
              <th>Name</th>
              <th>Status</th>
              <th>Languages</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-sm text-[var(--hub-muted)]">
                  Nothing found.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  {canEdit ? (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.item_code}`}
                        checked={selected.includes(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                    </td>
                  ) : null}
                  <td>
                    <Link
                      href={`/applications/${applicationId}/items/${item.id}`}
                      className="font-mono text-sm font-semibold text-[var(--hub-accent)] hover:underline"
                    >
                      {item.item_code}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate">{item.name || <span className="text-slate-400">—</span>}</td>
                  <td>
                    <Badge tone={statusTone(item.status === "CHANGES_REQUESTED" ? "ERROR" : item.status)}>
                      {ITEM_STATUS_LABEL[item.status]}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {item.target_languages.length === 0 ? (
                        <span className="text-xs text-[var(--hub-muted)]">Source only</span>
                      ) : (
                        item.target_languages.map((code) => (
                          <LanguageChip key={code} code={code} progress={item.progress[code]} />
                        ))
                      )}
                    </div>
                  </td>
                  <td className="text-xs whitespace-nowrap text-[var(--hub-muted)]">
                    {formatStamp(item.updated_at, timeZone)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
