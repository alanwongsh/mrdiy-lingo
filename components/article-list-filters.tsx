"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ContentTypeRecord, Language } from "@/lib/types";
import { MARKETS } from "@/lib/markets";
import { ContentTypeDialog } from "@/components/content-type-dialog";
import { FilterMultiSelect, FilterSelect } from "@/components/filter-select";
import { Button, Card, inputClass } from "@/components/ui";

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "DRAFT" },
  { value: "TRANSLATING", label: "TRANSLATING" },
  { value: "REVIEW", label: "REVIEW" },
  { value: "APPROVED", label: "APPROVED" },
  { value: "PUBLISHED", label: "PUBLISHED" },
];

const DUE_OPTIONS = [
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due soon (24h)" },
  { value: "scheduled", label: "Scheduled" },
  { value: "none", label: "No schedule" },
  { value: "published", label: "Published" },
];

export function ArticleListFilters({
  applicationId,
  languages,
  contentTypes,
  canEdit,
  initial,
}: {
  applicationId: string;
  languages: Language[];
  contentTypes: ContentTypeRecord[];
  canEdit: boolean;
  initial: {
    q: string;
    source: string[];
    status: string;
    type: string;
    market: string;
    due: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initial.q);
  const [source, setSource] = useState<string[]>(initial.source);
  const [status, setStatus] = useState(initial.status);
  const [type, setType] = useState(initial.type);
  const [market, setMarket] = useState(initial.market);
  const [due, setDue] = useState(initial.due);
  const [typeDialog, setTypeDialog] = useState<ContentTypeRecord | "new" | null>(
    null
  );
  const typeOptions = contentTypes
    .filter((item) => item.status === "ACTIVE" || item.code === type)
    .map((item) => ({
      value: item.code,
      label: item.status === "ACTIVE" ? item.name : `${item.name} (inactive)`,
    }));
  const activeCount =
    (source.length > 0 ? 1 : 0) +
    (status ? 1 : 0) +
    (type ? 1 : 0) +
    (market ? 1 : 0) +
    (due ? 1 : 0);
  const [filtersOpen, setFiltersOpen] = useState(activeCount > 0);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (source.length > 0) params.set("source", source.join(","));
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (market) params.set("market", market);
    if (due) params.set("due", due);
    const qs = params.toString();
    startTransition(() => {
      router.push(
        `/applications/${applicationId}/articles${qs ? `?${qs}` : ""}`
      );
    });
  }

  return (
    <>
    <Card className="mb-4 p-3 sm:p-4">
      <form onSubmit={applyFilters}>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title…"
            className={`${inputClass} h-9 min-w-0 flex-1`}
          />
          <button
            type="button"
            className={`inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold sm:hidden ${
              filtersOpen || activeCount > 0
                ? "border-[var(--hub-accent)] bg-[var(--hub-accent-soft)] text-[var(--hub-accent)]"
                : "border-[var(--hub-border-strong)] bg-white text-slate-800"
            }`}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters{activeCount > 0 ? ` · ${activeCount}` : ""}
          </button>
          <Button type="submit" className="hidden shrink-0 sm:inline-flex" disabled={pending}>
            {pending ? "Filtering…" : "Filter"}
          </Button>
        </div>
        <div
          className={`${filtersOpen ? "mt-3 grid" : "hidden"} grid-cols-1 gap-3 sm:mt-3 sm:flex sm:flex-wrap sm:items-center`}
        >
          <FilterMultiSelect
            value={source}
            onChange={setSource}
            placeholder="All source locales"
            options={languages.map((l) => ({
              value: l.code,
              label: `${l.name} (${l.code.toUpperCase()})`,
            }))}
          />
          <FilterSelect
            value={status}
            onChange={setStatus}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            value={type}
            onChange={setType}
            placeholder="All types"
            options={typeOptions}
            onEditOption={
              canEdit
                ? (option) => {
                    const match = contentTypes.find(
                      (item) => item.code === option.value
                    );
                    if (match) setTypeDialog(match);
                  }
                : undefined
            }
            footer={
              <div className="flex items-center justify-between gap-2 px-1">
                {canEdit ? (
                  <button
                    type="button"
                    className="text-sm font-semibold hover:underline text-[var(--hub-accent)]"
                    onClick={() => setTypeDialog("new")}
                  >
                    Add type
                  </button>
                ) : (
                  <span />
                )}
                <Link
                  href={`/applications/${applicationId}/types`}
                  className="text-sm text-slate-600 hover:underline"
                >
                  Manage types
                </Link>
              </div>
            }
          />
          <FilterSelect
            value={market}
            onChange={setMarket}
            placeholder="All markets"
            options={MARKETS.map((item) => ({
              value: item.code,
              label: `${item.code} · ${item.name}`,
            }))}
          />
          <FilterSelect
            value={due}
            onChange={setDue}
            placeholder="All due"
            options={DUE_OPTIONS}
          />
          <Button type="submit" className="w-full sm:hidden" disabled={pending}>
            {pending ? "Filtering…" : "Apply"}
          </Button>
        </div>
      </form>
    </Card>
    {typeDialog ? (
      <ContentTypeDialog
        applicationId={applicationId}
        contentType={typeDialog === "new" ? null : typeDialog}
        onClose={() => setTypeDialog(null)}
        onSaved={() => router.refresh()}
      />
    ) : null}
  </>
  );
}
