"use client";

import { useMemo, useState } from "react";
import type { SourceType } from "@/lib/types";
import { Badge, Button, Card } from "@/components/ui";
import {
  ArticleVersionComparer,
  TextVersionComparer,
} from "@/components/version-diff";

type BaseVersion = {
  id: string;
  version_number: number;
  source_type: SourceType;
  author: string | null;
  author_username?: string | null;
  created_at: string;
};

type TextVersion = BaseVersion & { translated_content: string };
type ArticleVersion = BaseVersion & {
  translated_content: {
    title: string;
    summary: string;
    body: string;
    seo_title: string;
    seo_description: string;
  };
};

function CollapseSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-slate-200 bg-white/80">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-semibold tracking-wide text-[var(--diy-red)] uppercase"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {label}
      </button>
      {open ? (
        <div className="border-t border-slate-100 px-2 py-2 text-sm text-slate-800">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Fixed locale and time zone so server and browser print the same text. */
function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** How a saved version came about, in words a reviewer reads at a glance. */
function howSaved(v: BaseVersion): string {
  const who = v.author?.trim();
  if (v.source_type === "SYSTEM") return "Auto-translated";
  if (v.source_type === "IMPORT") return who ? `Imported by ${who}` : "Imported";
  return who ? `Edited by ${who}` : "Edited";
}

/** Dropdown and heading text: number, time, and who, with no "v" shorthand. */
function versionLabel(v: BaseVersion, latest: boolean): string {
  return `Version ${v.version_number}${latest ? " (latest)" : ""} · ${formatWhen(v.created_at)} · ${howSaved(v)}`;
}

const EDITOR_NOW = "Editor now (not saved)";

export function StringVersionPanel({
  versions,
  draft,
  loading,
  error,
  pending,
  onRestore,
  onDelete,
}: {
  versions: TextVersion[];
  draft: string;
  loading?: boolean;
  error?: string;
  pending?: boolean;
  /** Leave out to show history without Use. */
  onRestore?: (text: string) => void;
  /** Leave out to show history without Delete. */
  onDelete?: (versionId: string, versionNumber: number) => void;
}) {
  const [tab, setTab] = useState<"list" | "compare">("list");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const latestId = versions[0]?.id;

  const compareOptions = useMemo(
    () => [
      { id: "current", label: EDITOR_NOW, text: draft },
      ...versions.map((v) => ({
        id: v.id,
        label: versionLabel(v, v.id === latestId),
        text: v.translated_content,
      })),
    ],
    [draft, versions, latestId]
  );

  return (
    <Card className="overflow-hidden border-[var(--diy-yellow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
        <h2 className="font-semibold text-slate-900">History</h2>
        <div className="flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              tab === "list"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
            onClick={() => setTab("list")}
          >
            Versions
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              tab === "compare"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
            onClick={() => setTab("compare")}
          >
            Compare
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        {!loading && tab === "list" ? (
          versions.length === 0 ? (
            <p className="text-sm text-slate-600">No versions yet.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => {
                const open = expandedId === v.id;
                const isLatest = v.id === latestId;
                return (
                  <li
                    key={v.id}
                    className={`rounded-lg border p-3 ${
                      isLatest
                        ? "border-sky-300 bg-sky-50/60"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center gap-2 text-left"
                      onClick={() => setExpandedId(open ? null : v.id)}
                    >
                      <span className="text-sm font-semibold text-slate-900">
                        Version {v.version_number}
                      </span>
                      {isLatest ? <Badge tone="info">Latest</Badge> : null}
                      <span className="text-xs text-slate-500">{howSaved(v)}</span>
                      <span className="ml-auto text-xs text-slate-500">
                        {formatWhen(v.created_at)}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          open
                            ? "text-[color:var(--diy-yellow-dark)]"
                            : "text-[var(--diy-red)]"
                        }`}
                      >
                        {open ? "Hide" : "Show"}
                      </span>
                    </button>
                    {open ? (
                      <div className="mt-3 space-y-3 border-t border-black/5 pt-3">
                        <p className="text-xs text-slate-500">
                          {howSaved(v)}
                          {v.author_username && v.source_type !== "SYSTEM" ? ` (${v.author_username})` : ""}
                          {` · ${formatWhen(v.created_at)}`}
                        </p>
                        <p className="whitespace-pre-wrap rounded-md bg-white/80 p-2 text-sm text-slate-900">
                          {v.translated_content}
                        </p>
                        {onRestore || onDelete ? (
                          <div className="flex flex-wrap gap-2">
                            {onRestore ? (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => onRestore(v.translated_content)}
                              >
                                Restore this version
                              </Button>
                            ) : null}
                            {onDelete ? (
                              <Button
                                type="button"
                                variant="danger"
                                disabled={pending}
                                onClick={() => onDelete(v.id, v.version_number)}
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {!loading && tab === "compare" ? (
          <TextVersionComparer
            options={compareOptions}
            defaultLeftId={versions[1]?.id ?? versions[0]?.id}
            defaultRightId="current"
          />
        ) : null}
      </div>
    </Card>
  );
}

export function ArticleVersionPanel({
  versions,
  draft,
  loading,
  error,
  pending,
  onRestore,
  onDelete,
}: {
  versions: ArticleVersion[];
  draft: ArticleVersion["translated_content"];
  loading?: boolean;
  error?: string;
  pending?: boolean;
  onRestore: (fields: ArticleVersion["translated_content"]) => void;
  onDelete: (versionId: string, versionNumber: number) => void;
}) {
  const [tab, setTab] = useState<"list" | "compare">("list");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const latestId = versions[0]?.id;

  const compareOptions = useMemo(
    () => [
      { id: "current", label: EDITOR_NOW, fields: draft },
      ...versions.map((v) => ({
        id: v.id,
        label: versionLabel(v, v.id === latestId),
        fields: v.translated_content,
      })),
    ],
    [draft, versions, latestId]
  );

  return (
    <Card className="overflow-hidden border-[var(--diy-yellow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
        <h2 className="font-semibold text-slate-900">History</h2>
        <div className="flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              tab === "list"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
            onClick={() => setTab("list")}
          >
            Versions
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              tab === "compare"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
            onClick={() => setTab("compare")}
          >
            Compare
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        {!loading && tab === "list" ? (
          versions.length === 0 ? (
            <p className="text-sm text-slate-600">No versions yet.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => {
                const open = expandedId === v.id;
                const isLatest = v.id === latestId;
                return (
                  <li
                    key={v.id}
                    className={`rounded-lg border p-3 ${
                      isLatest
                        ? "border-sky-300 bg-sky-50/60"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center gap-2 text-left"
                      onClick={() => setExpandedId(open ? null : v.id)}
                    >
                      <span className="text-sm font-semibold text-slate-900">
                        Version {v.version_number}
                      </span>
                      {isLatest ? <Badge tone="info">Latest</Badge> : null}
                      <span className="text-xs text-slate-500">{howSaved(v)}</span>
                      <span className="ml-auto shrink-0 text-xs text-slate-500">
                        {formatWhen(v.created_at)}
                      </span>
                      <span
                        className={`shrink-0 text-xs font-semibold ${
                          open
                            ? "text-[color:var(--diy-yellow-dark)]"
                            : "text-[var(--diy-red)]"
                        }`}
                      >
                        {open ? "Hide" : "Show"}
                      </span>
                    </button>
                    {open ? (
                      <div className="mt-3 space-y-3 border-t border-black/5 pt-3">
                        <p className="text-xs text-slate-500">
                          {howSaved(v)}
                          {v.author_username && v.source_type !== "SYSTEM" ? ` (${v.author_username})` : ""}
                          {` · ${formatWhen(v.created_at)}`}
                        </p>
                        <div className="space-y-2">
                          <CollapseSection label="Title" defaultOpen>
                            <p className="font-medium text-slate-900">
                              {v.translated_content.title || "—"}
                            </p>
                          </CollapseSection>
                          <CollapseSection label="Description" defaultOpen>
                            <p className="text-slate-600">
                              {v.translated_content.summary || "—"}
                            </p>
                          </CollapseSection>
                          <CollapseSection label="Body">
                            {v.translated_content.body ? (
                              <div
                                className="html-editor-surface text-slate-700"
                                dangerouslySetInnerHTML={{
                                  __html: v.translated_content.body,
                                }}
                              />
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </CollapseSection>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onRestore(v.translated_content)}
                          >
                            Restore this version
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            disabled={pending}
                            onClick={() =>
                              onDelete(v.id, v.version_number)
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {!loading && tab === "compare" ? (
          <ArticleVersionComparer
            options={compareOptions}
            defaultLeftId={versions[1]?.id ?? versions[0]?.id}
            defaultRightId="current"
          />
        ) : null}
      </div>
    </Card>
  );
}
