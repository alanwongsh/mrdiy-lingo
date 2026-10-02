import type { ContentLifecycleStatus } from "@/lib/types";

export type PublishDueKind =
  | "none"
  | "published"
  | "scheduled"
  | "due_soon"
  | "overdue";

export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

export function getPublishDueState(
  scheduledPublishAt: string | null | undefined,
  status: ContentLifecycleStatus,
  publishedAt: string | null | undefined,
  now = Date.now()
): {
  kind: PublishDueKind;
  label: string;
  countdown: string;
  tone: "neutral" | "good" | "warn" | "bad" | "info";
} {
  if (status === "PUBLISHED" || publishedAt) {
    return {
      kind: "published",
      label: "Published",
      countdown: "",
      tone: "good",
    };
  }

  if (!scheduledPublishAt) {
    return {
      kind: "none",
      label: "No schedule",
      countdown: "",
      tone: "neutral",
    };
  }

  const target = new Date(scheduledPublishAt).getTime();
  if (Number.isNaN(target)) {
    return {
      kind: "none",
      label: "No schedule",
      countdown: "",
      tone: "neutral",
    };
  }

  const diff = target - now;

  if (diff <= 0) {
    return {
      kind: "overdue",
      label: "Overdue",
      countdown: formatDuration(-diff, "ago"),
      tone: "bad",
    };
  }

  if (diff <= DUE_SOON_MS) {
    return {
      kind: "due_soon",
      label: "Due soon",
      countdown: formatDuration(diff, "left"),
      tone: "warn",
    };
  }

  return {
    kind: "scheduled",
    label: "Scheduled",
    countdown: formatDuration(diff, "left"),
    tone: "info",
  };
}

function formatDuration(ms: number, suffix: "left" | "ago") {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return `${parts.join(" ")} ${suffix}`;
}
