import { formatDateTime, fromZonedInput, toZonedInput } from "@/lib/datetime";
import { languageKey } from "@/lib/target-languages";
import type { ContentLifecycleStatus, PublicationStatus } from "@/lib/types";

/** Statuses where the article is approved and may be sent to providers. */
export const PUBLISHABLE_STATUSES: ContentLifecycleStatus[] = ["APPROVED", "PUBLISHING", "PUBLISHED"];

export function isPublishable(status: ContentLifecycleStatus | string) {
  return PUBLISHABLE_STATUSES.includes(status as ContentLifecycleStatus);
}

/** Clean a stored or submitted schedule: lower-case language keys, valid times only. */
export function normalizeLanguageSchedule(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [code, when] of Object.entries(value as Record<string, unknown>)) {
    const key = languageKey(code);
    if (!key || typeof when !== "string" || !when.trim()) continue;
    const time = new Date(when);
    if (Number.isNaN(time.getTime())) continue;
    out[key] = time.toISOString();
  }
  return out;
}

/** The language's own time, else the article's default time. */
export function languagePublishAt(
  article: { scheduled_publish_at: string | null; language_publish_at?: Record<string, string> | null },
  languageCode: string
): string | null {
  return article.language_publish_at?.[languageKey(languageCode)] ?? article.scheduled_publish_at ?? null;
}

export function isDue(when: string | null, now = Date.now()) {
  if (!when) return false;
  const time = new Date(when).getTime();
  return !Number.isNaN(time) && time <= now;
}

/**
 * Status after a publish pass, or null to leave it alone.
 * APPROVED -> PUBLISHING when the first ticked language is live,
 * -> PUBLISHED when every ticked language is live, and back to PUBLISHING
 * when a language is ticked later and has not gone out yet.
 */
export function nextPublishStatus(
  current: ContentLifecycleStatus | string,
  ticked: number,
  live: number
): ContentLifecycleStatus | null {
  if (!isPublishable(current) || ticked === 0) return null;
  const next: ContentLifecycleStatus =
    live >= ticked ? "PUBLISHED" : live > 0 ? "PUBLISHING" : current === "PUBLISHED" ? "PUBLISHING" : "APPROVED";
  return next === current ? null : next;
}

/** ISO time -> value for the date-time picker, in the viewer's time zone. */
export function toLocalInput(iso: string | null | undefined, timeZone: string) {
  return toZonedInput(iso, timeZone);
}

export function fromLocalInput(value: string, timeZone: string): string | null {
  return fromZonedInput(value, timeZone);
}

/** Same style as the rest of the article pages, in the viewer's time zone. */
export function formatWhen(iso: string, timeZone: string) {
  return formatDateTime(iso, timeZone);
}

function formatIn(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${rest}m`;
  return `in ${rest}m`;
}

export type WaitingEstimate = {
  /** Short badge text. */
  label: string;
  /** Longer line shown beside the badge. */
  detail: string;
  tone: "warn" | "info" | "neutral" | "bad";
};

/** What a ticked language that is not live yet is waiting for, and when it should go out. */
export function waitingEstimate(input: {
  publicationStatus?: PublicationStatus;
  articleStatus: ContentLifecycleStatus | string;
  translationApproved: boolean;
  publishAt: string | null;
  timeZone: string;
  now?: number;
}): WaitingEstimate {
  const now = input.now ?? Date.now();
  if (input.publicationStatus === "PENDING") {
    return { label: "Publishing", detail: "Sending to the provider now.", tone: "info" };
  }
  const retry = input.publicationStatus === "FAILED";
  if (!isPublishable(input.articleStatus)) {
    return {
      label: retry ? "Failed" : "Waiting",
      detail: "Goes out after the article is approved.",
      tone: retry ? "bad" : "neutral",
    };
  }
  if (!input.translationApproved) {
    return {
      label: retry ? "Failed" : "Waiting",
      detail: "Goes out after this translation is approved.",
      tone: retry ? "bad" : "neutral",
    };
  }
  if (!input.publishAt) {
    return {
      label: retry ? "Failed" : "Waiting",
      detail: "No publish time set. Set one or use Publish now.",
      tone: retry ? "bad" : "neutral",
    };
  }
  const at = new Date(input.publishAt).getTime();
  if (Number.isNaN(at) || at <= now) {
    return {
      label: retry ? "Retrying" : "Due now",
      detail: retry ? "Tries again within a minute." : "Goes out within a minute.",
      tone: "warn",
    };
  }
  return {
    label: "Scheduled",
    detail: `${formatWhen(input.publishAt, input.timeZone)} (${formatIn(at - now)})`,
    tone: "info",
  };
}
