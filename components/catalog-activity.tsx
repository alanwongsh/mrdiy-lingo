"use client";

import { useState } from "react";
import { ITEM_STATUS_LABEL } from "@/lib/catalog";
import { Badge, Card } from "@/components/ui";
import type { CatalogEvent, CatalogEventKind, ItemStatus } from "@/lib/types";

const PREVIEW = 10;
/** Rows saved before action ids existed are grouped when the same person wrote them this close together. */
const LEGACY_GROUP_MS = 3000;

/** The first kind found is the headline; everything else in the entry is listed under it. */
const HEADLINE_ORDER: CatalogEventKind[] = [
  "CREATED",
  "DELETED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "SUBMITTED",
  "LANGUAGE_APPROVED",
  "TRANSLATED",
  "EDITED",
  "REOPENED",
];

type ActivityGroup = {
  key: string;
  actor: string;
  at: string;
  /** Oldest first, so the lines read in the order things happened. */
  events: CatalogEvent[];
};

function actionIdOf(event: CatalogEvent): string | null {
  const id = event.detail?.action_id;
  return typeof id === "string" && id ? id : null;
}

/** Events arrive newest first. Neighbours from the same action become one entry. */
function groupEvents(events: CatalogEvent[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  let current: ActivityGroup | null = null;
  let currentId: string | null = null;
  let lastAt = 0;
  for (const event of events) {
    const id = actionIdOf(event);
    const at = new Date(event.created_at).getTime();
    const sameAction =
      current &&
      (id
        ? id === currentId
        : !currentId &&
          current.actor === event.actor_name &&
          Math.abs(lastAt - at) <= LEGACY_GROUP_MS);
    if (current && sameAction) {
      current.events.unshift(event);
    } else {
      current = { key: event.id, actor: event.actor_name, at: event.created_at, events: [event] };
      currentId = id;
      groups.push(current);
    }
    lastAt = at;
  }
  return groups;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status: string): "neutral" | "good" | "bad" | "info" {
  if (status === "APPROVED") return "good";
  if (status === "CHANGES_REQUESTED") return "bad";
  if (status === "REVIEW") return "info";
  return "neutral";
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{ITEM_STATUS_LABEL[status as ItemStatus] ?? status}</Badge>;
}

function StatusMove({ from, to }: { from: string | null; to: string | null }) {
  if (!to) return null;
  if (!from || from === to) return <StatusBadge status={to} />;
  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge status={from} />
      <span aria-label="to" className="text-slate-400">
        →
      </span>
      <StatusBadge status={to} />
    </span>
  );
}

function headlineOf(group: ActivityGroup): CatalogEvent {
  for (const kind of HEADLINE_ORDER) {
    const match = group.events.find((event) => event.event === kind);
    if (match) return match;
  }
  return group.events[0];
}

/** The item's status before and after the whole entry, or null when it did not move. */
function overallStatus(group: ActivityGroup) {
  const moves = group.events.filter((event) => event.to_status && event.event !== "DELETED");
  if (moves.length === 0) return null;
  const from = moves[0].from_status;
  const to = moves[moves.length - 1].to_status;
  return from === to ? null : { from, to, steps: moves };
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v) : [];

export function CatalogActivity({
  events,
  itemLabel,
  languageName,
}: {
  events: CatalogEvent[];
  itemLabel: string;
  languageName: (code: string) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const groups = groupEvents(events);
  const visible = showAll ? groups : groups.slice(0, PREVIEW);
  const thing = itemLabel.toLowerCase();

  function headlineText(head: CatalogEvent): string {
    const detail = head.detail ?? {};
    switch (head.event) {
      case "CREATED":
        return text(detail.import) ? `Imported the ${thing}` : `Created the ${thing}`;
      case "DELETED":
        return `Deleted the ${thing}`;
      case "CHANGES_REQUESTED":
        return "Asked for changes";
      case "APPROVED":
        return `Approved the ${thing}`;
      case "SUBMITTED":
        return "Sent for review";
      case "LANGUAGE_APPROVED":
        return `Approved ${head.language_code ? languageName(head.language_code) : "a language"}`;
      case "TRANSLATED":
        return "Auto-translated";
      case "REOPENED":
        return "Moved back to review";
      case "EDITED":
        if (text(detail.added)) return "Added a field";
        if (text(detail.removed) && list(detail.fields).length > 0) return "Removed a field";
        if (text(detail.removed)) return "Removed a file";
        if (text(detail.file)) return "Uploaded a file";
        if (text(detail.import)) return "Updated from an import";
        return head.language_code ? `Edited ${languageName(head.language_code)}` : `Edited the ${thing}`;
    }
  }

  /** Short lines for everything in the entry, the headline included, besides the status badges. */
  function detailLines(group: ActivityGroup, status: ReturnType<typeof overallStatus>): string[] {
    const lines: string[] = [];
    const others: string[] = [];
    const head = headlineOf(group);
    for (const event of group.events) {
      const isHead = event === head;
      const detail = event.detail ?? {};
      const reason = text(detail.reason);
      const lang = event.language_code ? languageName(event.language_code) : null;
      switch (event.event) {
        case "CREATED":
          if (text(detail.import)) lines.push(`From ${detail.import}`);
          break;
        case "EDITED": {
          const parts: string[] = [];
          const fields = list(detail.fields);
          if (text(detail.added)) parts.push(`${detail.added}`);
          else if (text(detail.removed) && fields.length > 0) parts.push(`${detail.removed}, with its text and files`);
          else if (text(detail.removed)) parts.push(`${detail.removed}${lang ? ` · ${lang}` : ""}`);
          else if (text(detail.file)) parts.push(`${detail.file}${fields.length ? ` into ${fields.join(", ")}` : ""}${lang ? ` · ${lang}` : ""}`);
          else if (fields.length > 0) parts.push(`Changed ${fields.join(", ")}${!isHead && lang ? ` · ${lang}` : ""}`);
          if (text(detail.import)) {
            parts.push(
              `From ${detail.import}${typeof detail.values === "number" ? ` · ${detail.values} value${detail.values === 1 ? "" : "s"}` : ""}`
            );
          }
          if (parts.length > 0) (isHead ? lines : others).push(parts.join(" · "));
          break;
        }
        case "TRANSLATED": {
          const languages = list(detail.languages).map(languageName);
          const written = typeof detail.values === "number" ? detail.values : null;
          const line = [
            languages.length ? `Into ${languages.join(", ")}` : null,
            written !== null ? `${written} value${written === 1 ? "" : "s"} written` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          if (line) (isHead ? lines : others).push(isHead ? line : `Auto-translated · ${line}`);
          break;
        }
        case "LANGUAGE_APPROVED":
          if (!isHead && lang) others.push(`${lang} approved`);
          break;
        case "SUBMITTED":
        case "APPROVED":
        case "REOPENED":
          if (status && status.steps.length > 1 && !isHead) {
            others.push(
              `${ITEM_STATUS_LABEL[event.from_status as ItemStatus] ?? event.from_status} → ${
                ITEM_STATUS_LABEL[event.to_status as ItemStatus] ?? event.to_status
              }${reason ? ` · ${reason}` : ""}`
            );
          } else if (reason) {
            lines.push(reason);
          }
          break;
        default:
          break;
      }
    }
    return [...lines, ...others];
  }

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Activity</h2>
        {groups.length > 0 ? (
          <span className="text-xs text-slate-500">
            {groups.length} {groups.length === 1 ? "action" : "actions"}
          </span>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No activity recorded yet.</p>
      ) : (
        <ol className="mt-4 space-y-0">
          {visible.map((group) => {
            const head = headlineOf(group);
            const status = overallStatus(group);
            const lines = detailLines(group, status);
            const comment = group.events.find((event) => event.comment)?.comment;
            return (
              <li key={group.key} className="relative border-l border-[var(--hub-border)] pb-4 pl-4 last:pb-0">
                <span
                  className={`absolute top-1.5 -left-[5px] h-2.5 w-2.5 rounded-full border-2 border-white ${
                    head.event === "APPROVED" || head.event === "LANGUAGE_APPROVED"
                      ? "bg-emerald-500"
                      : head.event === "CHANGES_REQUESTED" || head.event === "DELETED"
                        ? "bg-red-500"
                        : head.event === "SUBMITTED"
                          ? "bg-sky-500"
                          : "bg-slate-400"
                  }`}
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-900">{group.actor}</span>
                  <span className="text-slate-600">{headlineText(head)}</span>
                  {status ? (
                    <StatusMove from={status.from} to={status.to} />
                  ) : head.event === "CREATED" || head.event === "DELETED" ? (
                    <StatusMove from={null} to={head.to_status ?? head.from_status} />
                  ) : null}
                  <span className="ml-auto text-xs text-slate-400">{formatWhen(group.at)}</span>
                </div>
                {lines.map((line, index) => (
                  <p key={index} className="mt-1 text-xs text-slate-500">
                    {line}
                  </p>
                ))}
                {comment ? (
                  <blockquote className="mt-1.5 border-l-2 border-red-300 pl-2 text-sm text-slate-700">
                    {comment}
                  </blockquote>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {groups.length > PREVIEW ? (
        <button
          type="button"
          className="mt-4 text-sm font-semibold text-[var(--hub-accent)] hover:underline"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show all ${groups.length}`}
        </button>
      ) : null}
    </Card>
  );
}
