"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Language, Namespace } from "@/lib/types";
import { FilterSelect } from "@/components/filter-select";
import { Button, Card, inputClass } from "@/components/ui";

const STATUS_OPTIONS = [
  { value: "MISSING", label: "MISSING" },
  { value: "SYSTEM_GENERATED", label: "SYSTEM_GENERATED" },
  { value: "MANUALLY_MODIFIED", label: "MANUALLY_MODIFIED" },
  { value: "APPROVED", label: "APPROVED" },
];

export function TranslationListFilters({
  applicationId,
  namespaces,
  languages,
  initial,
}: {
  applicationId: string;
  namespaces: Pick<Namespace, "id" | "name">[];
  languages: Language[];
  initial: {
    q: string;
    namespaceId: string;
    language: string;
    status: string;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initial.q);
  const [namespaceId, setNamespaceId] = useState(initial.namespaceId);
  const [language, setLanguage] = useState(initial.language);
  const [status, setStatus] = useState(initial.status);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (namespaceId) params.set("namespaceId", namespaceId);
    if (language) params.set("language", language);
    if (status) params.set("status", status);
    const qs = params.toString();
    startTransition(() => {
      router.push(
        `/applications/${applicationId}/translations${qs ? `?${qs}` : ""}`
      );
    });
  }

  return (
    <Card className="mb-4 p-4">
      <form className="flex flex-wrap items-center gap-3" onSubmit={applyFilters}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search keys…"
          className={`${inputClass} h-9 min-w-64 flex-1`}
        />
        <FilterSelect
          value={namespaceId}
          onChange={setNamespaceId}
          placeholder="All namespaces"
          options={namespaces.map((ns) => ({
            value: ns.id,
            label: ns.name,
          }))}
        />
        <FilterSelect
          value={language}
          onChange={setLanguage}
          placeholder="All languages"
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
        <Button type="submit" disabled={pending}>
          {pending ? "Filtering…" : "Filter"}
        </Button>
      </form>
    </Card>
  );
}
