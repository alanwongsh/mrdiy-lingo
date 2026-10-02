"use client";

import { useMemo, useState } from "react";
import { diffWords, summarizeDiff, type DiffToken } from "@/lib/diff";
import { Badge, Card, Field, inputClass } from "@/components/ui";

function DiffText({ tokens }: { tokens: DiffToken[] }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">
      {tokens.map((token, index) => {
        if (token.type === "equal") {
          return <span key={index}>{token.text}</span>;
        }
        if (token.type === "remove") {
          return (
            <span
              key={index}
              className="rounded-sm bg-red-100 px-0.5 text-red-800 line-through decoration-red-400"
            >
              {token.text}
            </span>
          );
        }
        return (
          <span
            key={index}
            className="rounded-sm bg-emerald-100 px-0.5 font-medium text-emerald-900"
          >
            {token.text}
          </span>
        );
      })}
    </p>
  );
}

export type CompareOption = {
  id: string;
  label: string;
  text: string;
};

export function TextVersionComparer({
  options,
  defaultLeftId,
  defaultRightId,
}: {
  options: CompareOption[];
  defaultLeftId?: string;
  defaultRightId?: string;
}) {
  const [leftId, setLeftId] = useState(
    defaultLeftId ?? options[1]?.id ?? options[0]?.id ?? ""
  );
  const [rightId, setRightId] = useState(
    defaultRightId ?? options[0]?.id ?? ""
  );

  const left = options.find((o) => o.id === leftId) ?? options[0];
  const right = options.find((o) => o.id === rightId) ?? options[0];

  const tokens = useMemo(
    () => diffWords(left?.text ?? "", right?.text ?? ""),
    [left?.text, right?.text]
  );
  const summary = useMemo(() => summarizeDiff(tokens), [tokens]);

  if (options.length < 2) {
    return (
      <p className="text-sm text-slate-600">
        Need at least two versions (or current draft) to compare.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <select
            className={inputClass}
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select
            className={inputClass}
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone={summary.changed ? "warn" : "good"}>
          {summary.changed ? "Changes found" : "Identical"}
        </Badge>
        <Badge tone="bad">Removed segments: {summary.removed}</Badge>
        <Badge tone="good">Added segments: {summary.added}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--hub-border)] bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            From · {left?.label}
          </div>
          <div className="p-3 text-sm whitespace-pre-wrap text-slate-800">
            {left?.text || "—"}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--hub-border)] bg-[var(--diy-red-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--diy-red)]">
            To · {right?.label}
          </div>
          <div className="p-3 text-sm whitespace-pre-wrap text-slate-800">
            {right?.text || "—"}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hub-border)] bg-[var(--diy-yellow-soft)] px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Visual difference
          </div>
          <div className="flex gap-3 text-[11px] text-slate-600">
            <span>
              <span className="mr-1 rounded-sm bg-red-100 px-1 line-through">
                removed
              </span>
            </span>
            <span>
              <span className="mr-1 rounded-sm bg-emerald-100 px-1">added</span>
            </span>
          </div>
        </div>
        <div className="p-3">
          <DiffText tokens={tokens} />
        </div>
      </Card>
    </div>
  );
}

export type ArticleCompareOption = {
  id: string;
  label: string;
  fields: {
    title: string;
    summary: string;
    body: string;
    seo_title: string;
    seo_description: string;
  };
};

const ARTICLE_FIELDS = [
  ["title", "Title"],
  ["summary", "Description"],
  ["body", "Body"],
] as const;

export function ArticleVersionComparer({
  options,
  defaultLeftId,
  defaultRightId,
}: {
  options: ArticleCompareOption[];
  defaultLeftId?: string;
  defaultRightId?: string;
}) {
  const [leftId, setLeftId] = useState(
    defaultLeftId ?? options[1]?.id ?? options[0]?.id ?? ""
  );
  const [rightId, setRightId] = useState(
    defaultRightId ?? options[0]?.id ?? ""
  );

  const left = options.find((o) => o.id === leftId) ?? options[0];
  const right = options.find((o) => o.id === rightId) ?? options[0];

  if (options.length < 2) {
    return (
      <p className="text-sm text-slate-600">
        Need at least two versions (or current draft) to compare.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From">
          <select
            className={inputClass}
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select
            className={inputClass}
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-4">
        {ARTICLE_FIELDS.map(([key, label]) => {
          const tokens = diffWords(
            left?.fields[key] ?? "",
            right?.fields[key] ?? ""
          );
          const summary = summarizeDiff(tokens);
          return (
            <Card key={key} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hub-border)] bg-slate-50 px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {label}
                </div>
                <Badge tone={summary.changed ? "warn" : "good"}>
                  {summary.changed ? "Changed" : "Same"}
                </Badge>
              </div>
              <div className="grid gap-0 lg:grid-cols-2">
                <div className="border-b border-[var(--hub-border)] p-3 text-sm whitespace-pre-wrap text-slate-700 lg:border-r lg:border-b-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">
                    From
                  </div>
                  {left?.fields[key] || "—"}
                </div>
                <div className="p-3 text-sm whitespace-pre-wrap text-slate-700">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">
                    To
                  </div>
                  {right?.fields[key] || "—"}
                </div>
              </div>
              <div className="border-t border-[var(--hub-border)] bg-[var(--diy-yellow-soft)]/40 p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">
                  Diff
                </div>
                <DiffText tokens={tokens} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
