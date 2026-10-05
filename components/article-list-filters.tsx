"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Language } from "@/lib/types";
import { MARKETS } from "@/lib/markets";
import { FilterMultiSelect, FilterSelect } from "@/components/filter-select";
import { Button, Card, inputClass } from "@/components/ui";

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "DRAFT" },
  { value: "TRANSLATING", label: "TRANSLATING" },
  { value: "REVIEW", label: "REVIEW" },
  { value: "APPROVED", label: "APPROVED" },
  { value: "PUBLISHED", label: "PUBLISHED" },
];

const TYPE_OPTIONS = [
  { value: "ARTICLE", label: "ARTICLE" },
  { value: "NEWS", label: "NEWS" },
  { value: "ANNOUNCEMENT", label: "ANNOUNCEMENT" },
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
  initial,
}: {
  applicationId: string;
  languages: Language[];
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
    <Card className="mb-4 p-4">
      <form className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center" onSubmit={applyFilters}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title…"
          className={`${inputClass} h-9 w-full min-w-0 sm:min-w-64 sm:flex-1`}
        />
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
          options={TYPE_OPTIONS}
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
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Filtering…" : "Filter"}
        </Button>
      </form>
    </Card>
  );
}
