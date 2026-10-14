"use client";

import { useState } from "react";
import { Badge, Card, statusTone } from "@/components/ui";
import type { ContentAuditEvent, ContentAuditEventKind } from "@/lib/types";

const PREVIEW = 10;
/** Rows saved before action ids existed are grouped when the same person wrote them this close together. */
const LEGACY_GROUP_MS = 3000;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  TRANSLATING: "Translating",
  REVIEW: "Review",
  APPROVED: "Approved",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  MISSING: "Missing",
  SYSTEM_GENERATED: "Auto",
  MANUALLY_MODIFIED: "Edited",
};

const EVENT_LABEL: Record<ContentAuditEventKind, string> = {
  CREATED: "Created the article",
  STATUS_CHANGED: "Changed status",
  EDITED: "Edited the article",
  TRANSLATION_SAVED: "Saved a translation",
  TRANSLATION_APPROVED: "Approved a translation",
  TRANSLATION_UNAPPROVED: "Cleared an approval",
  DELETED: "Deleted the article",
};

/** What a status move reads as when it is the headline of an entry. */
const STATUS_HEADLINE: Record<string, string> = {
  DRAFT: "Moved to draft",
  TRANSLATING: "Started translating",
  REVIEW: "Sent for review",
  APPROVED: "Approved the article",
  PUBLISHING: "Started publishing",
  PUBLISHED: "Published the article",
};

/** The first kind found is the headline; everything else in the entry is listed under it. */
const HEADLINE_ORDER: ContentAuditEventKind[] = [
  "CREATED",
  "DELETED",
  "EDITED",
  "STATUS_CHANGED",
  "TRANSLATION_APPROVED",
  "TRANSLATION_UNAPPROVED",
  "TRANSLATION_SAVED",
];

type ActivityGroup = {
  key: string;
  actor: string;
  at: string;
  /** Oldest first, so the lines read in the order things happened. */
  events: ContentAuditEvent[];
};

function actionIdOf(event: ContentAuditEvent): string | null {
  const id = event.detail?.action_id;
  return typeof id === "string" && id ? id : null;
}

/** Events arrive newest first. Neighbours from the same save become one entry. */
function groupEvents(events: ContentAuditEvent[]): ActivityGroup[] {
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

function statusName(status: string) {
  return STATUS_LABEL[status] ?? status;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{statusName(status)}</Badge>;
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

function headlineOf(group: ActivityGroup): ContentAuditEvent {
  for (const kind of HEADLINE_ORDER) {
    const match = group.events.find((event) => event.event === kind);
    if (match) return match;
  }
  return group.events[0];
}

/** The article's status before and after the whole entry, or null when it did not move. */
function overallStatus(group: ActivityGroup) {
  const moves = group.events.filter(
    (event) => event.event === "STATUS_CHANGED" && event.to_status
  );
  if (moves.length === 0) return null;
  const from = moves[0].from_status;
  const to = moves[moves.length - 1].to_status;
  return from === to ? null : { from, to, steps: moves };
}

function headlineText(head: ContentAuditEvent, status: ReturnType<typeof overallStatus>) {
  if (head.event === "STATUS_CHANGED" && status?.to) {
    return STATUS_HEADLINE[status.to] ?? EVENT_LABEL.STATUS_CHANGED;
  }
  return EVENT_LABEL[head.event] ?? head.event;
}

function reasonOf(event: ContentAuditEvent): string | null {
  const reason = event.detail?.reason;
  return typeof reason === "string" && reason ? reason : null;
}

function versionOf(event: ContentAuditEvent): string {
  const version = event.detail?.version;
  return typeof version === "number" ? ` (version ${version})` : "";
}

/** Short lines for everything in the entry besides its headline and overall status. */
function detailLines(
  group: ActivityGroup,
  head: ContentAuditEvent,
  status: ReturnType<typeof overallStatus>
): string[] {
  const lines: string[] = [];
  const translationNotes: string[] = [];
  for (const event of group.events) {
    const isHead = event === head;
    const detail = event.detail ?? {};
    switch (event.event) {
      case "EDITED": {
        const parts: string[] = [];
        if (Array.isArray(detail.fields) && detail.fields.length > 0) {
          parts.push(`Changed ${detail.fields.join(", ")}`);
        }
        if (typeof detail.action === "string") {
          parts.push(
            `${event.language_code ? `${event.language_code} ` : ""}${detail.action.toLowerCase()}${versionOf(event)}`
          );
        }
        if (parts.length > 0) lines.push(parts.join(" · "));
        break;
      }
      case "STATUS_CHANGED": {
        // One move is already in the headline badges; several are listed step by step.
        if (status && status.steps.length > 1) {
          const reason = reasonOf(event);
          lines.push(
            `${statusName(event.from_status ?? "")} → ${statusName(event.to_status ?? "")}${reason ? ` · ${reason}` : ""}`
          );
        } else {
          const reason = reasonOf(event);
          if (reason) lines.push(reason);
        }
        break;
      }
      case "TRANSLATION_SAVED": {
        if (isHead) {
          const parts: string[] = [];
          if (typeof detail.version === "number") parts.push(`Version ${detail.version}`);
          if (detail.source_type === "SYSTEM") parts.push("Machine translation");
          if (parts.length > 0) lines.push(parts.join(" · "));
        } else {
          translationNotes.push(
            `${event.language_code} ${detail.source_type === "SYSTEM" ? "translated" : "saved"}${versionOf(event)}`
          );
        }
        break;
      }
      case "TRANSLATION_APPROVED":
        if (isHead) {
          const reason = reasonOf(event);
          if (reason) lines.push(reason);
        } else {
          translationNotes.push(`${event.language_code} approved`);
        }
        break;
      case "TRANSLATION_UNAPPROVED":
        if (isHead) {
          const reason = reasonOf(event);
          if (reason) lines.push(reason);
        } else {
          translationNotes.push(`${event.language_code} approval cleared`);
        }
        break;
      default:
        break;
    }
  }
  if (translationNotes.length > 0) lines.push(translationNotes.join(" · "));
  return lines;
}

export function ArticleActivity({
  events,
  loadError,
}: {
  events: ContentAuditEvent[];
  loadError?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const groups = groupEvents(events);
  const visible = showAll ? groups : groups.slice(0, PREVIEW);

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Activity</h2>
        {groups.length > 0 ? (
          <span className="text-xs text-slate-500">
            {groups.length} {groups.length === 1 ? "action" : "actions"}
          </span>
        ) : null}
      </div>

      {loadError ? (
        <p className="mt-3 text-sm text-red-700">{loadError}.</p>
      ) : groups.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No activity recorded yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-0">
          {visible.map((group) => {
            const head = headlineOf(group);
            const status = overallStatus(group);
            const lines = detailLines(group, head, status);
            const showsTranslation =
              head.event.startsWith("TRANSLATION_") || head.event === "EDITED";
            return (
              <li
                key={group.key}
                className="relative border-l border-[var(--hub-border)] pb-4 pl-4 last:pb-0"
              >
                <span className="absolute top-1.5 -left-[5px] h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-900">{group.actor}</span>
                  <span className="text-slate-600">{headlineText(head, status)}</span>
                  {showsTranslation && head.language_code ? (
                    <Badge tone="neutral">{head.language_code}</Badge>
                  ) : null}
                  {status ? (
                    <StatusMove from={status.from} to={status.to} />
                  ) : head.event === "CREATED" || head.event === "DELETED" ? (
                    <StatusMove from={null} to={head.to_status ?? head.from_status} />
                  ) : head.event.startsWith("TRANSLATION_") &&
                    head.from_status !== head.to_status ? (
                    <StatusMove from={head.from_status} to={head.to_status} />
                  ) : null}
                  <span className="ml-auto text-xs text-slate-400">
                    {formatWhen(group.at)}
                  </span>
                </div>
                {lines.map((line, index) => (
                  <p key={index} className="mt-1 text-xs text-slate-500">
                    {line}
                  </p>
                ))}
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
