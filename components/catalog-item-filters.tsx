"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ITEM_STATUS_LABEL } from "@/lib/catalog";
import { FilterSelect } from "@/components/filter-select";
import { Button, Card, inputClass } from "@/components/ui";

const STATUS_OPTIONS = Object.entries(ITEM_STATUS_LABEL).map(([value, label]) => ({ value, label }));

export function CatalogItemFilters({
  applicationId,
  itemLabel,
  initial,
}: {
  applicationId: string;
  itemLabel: string;
  initial: { q: string; status: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState(initial.status);

  function apply(nextStatus = status) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (nextStatus) params.set("status", nextStatus);
    const qs = params.toString();
    startTransition(() => {
      router.push(`/applications/${applicationId}/items${qs ? `?${qs}` : ""}`);
    });
  }

  return (
    <Card className="mb-3 p-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${inputClass} min-w-0 flex-1 sm:max-w-xs`}
          placeholder={`Search ${itemLabel} code or name`}
          aria-label={`Search ${itemLabel}`}
        />
        <FilterSelect
          ariaLabel="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            apply(value);
          }}
          placeholder="All statuses"
          options={STATUS_OPTIONS}
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>
    </Card>
  );
}
