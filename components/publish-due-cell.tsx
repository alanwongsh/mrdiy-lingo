"use client";

import { useEffect, useState } from "react";
import type { ContentLifecycleStatus } from "@/lib/types";
import { Badge } from "@/components/ui";
import { getPublishDueState } from "@/lib/publish-due";
import { useTimeZone } from "@/components/time-zone";
import { formatDateTime } from "@/lib/datetime";

export function PublishDueCell({
  scheduledPublishAt,
  publishedAt,
  status,
}: {
  scheduledPublishAt: string | null | undefined;
  publishedAt: string | null | undefined;
  status: ContentLifecycleStatus;
}) {
  const timeZone = useTimeZone();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const due = getPublishDueState(
    scheduledPublishAt,
    status,
    publishedAt,
    now
  );

  return (
    <div className="space-y-1">
      <Badge tone={due.tone}>{due.label}</Badge>
      {due.countdown ? (
        <div
          className={`text-sm font-semibold tabular-nums ${
            due.kind === "overdue"
              ? "text-red-700"
              : due.kind === "due_soon"
                ? "text-amber-800"
                : "text-slate-700"
          }`}
        >
          {due.countdown}
        </div>
      ) : null}
      {scheduledPublishAt ? (
        <div className="text-xs text-[var(--hub-muted)]">
          {formatDateTime(scheduledPublishAt, timeZone)}
        </div>
      ) : null}
    </div>
  );
}
