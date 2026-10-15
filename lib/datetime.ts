/**
 * Dates are stored as UTC (timestamptz) and shown in the viewer's browser time
 * zone. Every formatter takes the zone explicitly so server and browser print
 * the same text: components read it with useTimeZone(), server components with
 * requestTimeZone(). Until the browser has reported its zone, Malaysia time is
 * used.
 */

export const DEFAULT_TIME_ZONE = "Asia/Kuala_Lumpur";
export const TIME_ZONE_COOKIE = "lingo_tz";

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "15 Oct 2026, 14:05" */
export function formatDateTime(value: string | Date | null | undefined, timeZone: string): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "15 Oct 2026, 14:05:09", for logs. */
export function formatDateTimeSeconds(value: string | Date | null | undefined, timeZone: string): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "15 Oct 2026" */
export function formatDate(value: string | Date | null | undefined, timeZone: string): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** "14:05" */
export function formatTime(value: string | Date | null | undefined, timeZone: string): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** Offset name such as "GMT+8", shown next to times people pick. */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallClock(ms: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMs(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - (ms - (ms % 1000));
}

/** True when both instants fall on the same calendar day in the zone. */
export function isSameDay(a: string | Date, b: string | Date, timeZone: string): boolean {
  const x = toDate(a);
  const y = toDate(b);
  if (!x || !y) return false;
  const p = wallClock(x.getTime(), timeZone);
  const q = wallClock(y.getTime(), timeZone);
  return p.year === q.year && p.month === q.month && p.day === q.day;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC instant -> "YYYY-MM-DDTHH:mm" wall time in the zone (datetime-local format). */
export function toZonedInput(value: string | Date | null | undefined, timeZone: string): string {
  const date = toDate(value);
  if (!date) return "";
  const w = wallClock(date.getTime(), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" wall time in the zone -> UTC ISO string, or null. */
export function fromZonedInput(value: string | null | undefined, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value?.trim() ?? "");
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let ms = guess - offsetMs(guess, timeZone);
  const corrected = offsetMs(ms, timeZone);
  if (guess - corrected !== ms) ms = guess - corrected;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
