"use client";

import { useState } from "react";
import { Badge, Card, statusTone } from "@/components/ui";
import type { ContentAuditEvent, ContentAuditEventKind } from "@/lib/types";

const PREVIEW = 10;

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

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{STATUS_LABEL[status] ?? status}</Badge>;
}

function describe(event: ContentAuditEvent): string {
  const detail = event.detail ?? {};
  const parts: string[] = [];
  if (Array.isArray(detail.fields) && detail.fields.length > 0) {
    parts.push(`Changed ${detail.fields.join(", ")}`);
  }
  if (typeof detail.action === "string") parts.push(detail.action);
  if (typeof detail.version === "number") parts.push(`Version ${detail.version}`);
  if (detail.source_type === "SYSTEM") parts.push("Machine translation");
  if (typeof detail.reason === "string") parts.push(detail.reason);
  return parts.join(" · ");
}

export function ArticleActivity({
  events,
  loadError,
}: {
  events: ContentAuditEvent[];
  loadError?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.slice(0, PREVIEW);

  return (
    <Card className="mt-6 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Activity</h2>
        {events.length > 0 ? (
          <span className="text-xs text-slate-500">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
        ) : null}
      </div>

      {loadError ? (
        <p className="mt-3 text-sm text-red-700">{loadError}.</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No activity recorded yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-0">
          {visible.map((event) => {
            const note = describe(event);
            return (
              <li
                key={event.id}
                className="relative border-l border-[var(--hub-border)] pb-4 pl-4 last:pb-0"
              >
                <span className="absolute top-1.5 -left-[5px] h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-900">{event.actor_name}</span>
                  <span className="text-slate-600">{EVENT_LABEL[event.event] ?? event.event}</span>
                  {event.language_code ? (
                    <Badge tone="neutral">{event.language_code}</Badge>
                  ) : null}
                  {event.from_status && event.to_status ? (
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge status={event.from_status} />
                      <span aria-label="to" className="text-slate-400">
                        →
                      </span>
                      <StatusBadge status={event.to_status} />
                    </span>
                  ) : event.to_status ? (
                    <StatusBadge status={event.to_status} />
                  ) : null}
                  <span className="ml-auto text-xs text-slate-400">
                    {formatWhen(event.created_at)}
                  </span>
                </div>
                {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
              </li>
            );
          })}
        </ol>
      )}

      {events.length > PREVIEW ? (
        <button
          type="button"
          className="mt-4 text-sm font-semibold text-[var(--hub-accent)] hover:underline"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show all ${events.length}`}
        </button>
      ) : null}
    </Card>
  );
}
