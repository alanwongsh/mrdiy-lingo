"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TranslationKeyListItem } from "@/lib/actions/product";
import type { Language } from "@/lib/types";
import { FilterMultiSelect } from "@/components/filter-select";
import { Badge, Card, statusTone } from "@/components/ui";

export function TranslationKeyList({
  applicationId,
  languages,
  items,
}: {
  applicationId: string;
  languages: Language[];
  items: TranslationKeyListItem[];
}) {
  const [viewLangs, setViewLangs] = useState<string[]>(() =>
    languages.slice(0, 2).map((l) => l.code)
  );

  const viewOptions = useMemo(
    () =>
      languages.map((l) => ({
        value: l.code,
        label: `${l.name} (${l.code.toUpperCase()})`,
      })),
    [languages]
  );

  const selectedLangs = useMemo(
    () =>
      viewLangs
        .map((code) => languages.find((l) => l.code === code))
        .filter((l): l is Language => Boolean(l)),
    [viewLangs, languages]
  );

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <FilterMultiSelect
          value={viewLangs}
          onChange={setViewLangs}
          placeholder="Languages to show"
          options={viewOptions}
        />
        <p className="text-xs text-[var(--hub-muted)]">
          Pick which languages appear in each key&apos;s translation panel.
        </p>
      </Card>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--hub-muted)]">
            No translation keys found.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--hub-border)]">
            {items.map((item) => (
              <li
                key={item.id}
                className="grid gap-3 p-4 lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)]"
              >
                <div className="min-w-0 space-y-1.5">
                  <Link
                    href={`/applications/${applicationId}/translations/${item.id}`}
                    className="break-all font-mono text-sm font-semibold text-[var(--hub-accent)] hover:underline"
                  >
                    {item.key}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">
                      {item.namespace?.name ?? "—"}
                    </Badge>
                    <span className="text-[11px] text-[var(--hub-muted)]">
                      Source {item.source_language.toUpperCase()}
                    </span>
                  </div>
                  <p className="line-clamp-3 text-sm text-slate-600">
                    {item.source_text || (
                      <span className="text-slate-400">No source text</span>
                    )}
                  </p>
                </div>

                <div className="min-w-0">
                  {selectedLangs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--hub-border)] bg-slate-50 px-3 py-6 text-center text-xs text-[var(--hub-muted)]">
                      Select languages above to preview translations.
                    </div>
                  ) : (
                    <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-[var(--hub-border)] bg-slate-50/80 p-2">
                      {selectedLangs.map((lang) => {
                        const row = item.translations?.find(
                          (t) => t.language_code === lang.code
                        );
                        return (
                          <div
                            key={lang.code}
                            className="rounded-md border border-[var(--hub-border)] bg-white px-3 py-2 shadow-sm"
                          >
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-slate-800">
                                {lang.name}{" "}
                                <span className="font-mono text-[var(--hub-muted)]">
                                  ({lang.code.toUpperCase()})
                                </span>
                              </div>
                              <Badge
                                tone={
                                  row
                                    ? statusTone(row.status)
                                    : "neutral"
                                }
                              >
                                {row?.status ?? "MISSING"}
                              </Badge>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
                              {row?.current_text?.trim() ? (
                                row.current_text
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
