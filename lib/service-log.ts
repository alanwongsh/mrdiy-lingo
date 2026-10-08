import { appendFile, mkdir, readdir, readFile, unlink } from "fs/promises";
import path from "path";
import { requireSuperadmin } from "@/lib/auth/access";

const TEXT_LIMIT = 120_000;
const FILE_PREFIX = "service-";
const TIME_ZONE = "Asia/Kuala_Lumpur";

export type ServiceLogEntry = {
  /** Short name other features can filter on, such as "gemini". */
  source: string;
  ok?: boolean;
  message?: string;
  durationMs?: number;
  input?: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type ServiceLog = {
  id: string;
  createdAt: string;
  source: string;
  ok: boolean;
  durationMs: number | null;
  message: string;
  input: string | null;
  output: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};

/**
 * Daily files under logs/. SERVICE_LOG_RETENTION_DAYS defaults to 7.
 * Vercel can only write under /tmp, and that disk disappears with the instance.
 */
export function serviceLogConfig() {
  const parsed = Number(process.env.SERVICE_LOG_RETENTION_DAYS ?? "7");
  const retentionDays = Number.isFinite(parsed) ? Math.floor(parsed) : 7;
  return {
    directory: process.env.VERCEL ? path.join("/tmp", "lingo-logs") : path.join(process.cwd(), "logs"),
    retentionDays: Math.min(365, Math.max(1, retentionDays)),
  };
}

function clip(value: string | undefined, limit = TEXT_LIMIT) {
  const text = value?.trim();
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…truncated`;
}

function metadataJson(value: Record<string, unknown> | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function logDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDay(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function fileForDay(directory: string, day: string) {
  return path.join(directory, `${FILE_PREFIX}${day}.jsonl`);
}

async function clearExpiredLogs(directory: string, retentionDays: number) {
  const cutoff = shiftDay(logDay(), -(retentionDays - 1));
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  await Promise.all(
    names.map(async (name) => {
      const day = name.match(/^service-(\d{4}-\d{2}-\d{2})\.jsonl$/)?.[1];
      if (!day || day >= cutoff) return;
      await unlink(path.join(directory, name)).catch(() => undefined);
    })
  );
}

/** Append one JSON line to today's log file. Failures stay in the server console and do not throw. */
export async function writeServiceLog(entry: ServiceLogEntry): Promise<void> {
  const source = clip(entry.source, 80) ?? "app";
  const ok = entry.ok ?? !entry.error;
  const row = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source,
    ok,
    durationMs:
      typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
        ? Math.max(0, Math.round(entry.durationMs))
        : null,
    message: clip(entry.message, 500) ?? "",
    input: clip(entry.input),
    output: clip(entry.output),
    error: clip(entry.error, 4000),
    metadata: metadataJson(entry.metadata),
  };
  const { directory, retentionDays } = serviceLogConfig();
  try {
    await mkdir(directory, { recursive: true });
    await clearExpiredLogs(directory, retentionDays);
    await appendFile(fileForDay(directory, logDay()), `${JSON.stringify(row)}\n`, "utf8");
    const usage = row.metadata.usage;
    console.info(
      `[service-log] ${source} ${ok ? "ok" : "failed"}${
        row.durationMs != null ? ` ${row.durationMs}ms` : ""
      }${usage ? ` ${JSON.stringify(usage)}` : ""}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store the service log.";
    console.error(`[service-log] ${source} was not stored: ${message}`);
    console.info(`[service-log] ${JSON.stringify(row)}`);
  }
}

function asLog(value: unknown): ServiceLog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.at !== "string" || typeof row.source !== "string") {
    return null;
  }
  return {
    id: row.id,
    createdAt: row.at,
    source: row.source,
    ok: row.ok !== false,
    durationMs: typeof row.durationMs === "number" ? row.durationMs : null,
    message: typeof row.message === "string" ? row.message : "",
    input: typeof row.input === "string" ? row.input : null,
    output: typeof row.output === "string" ? row.output : null,
    error: typeof row.error === "string" ? row.error : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

export async function listServiceLogs(input: {
  page?: number;
  pageSize?: number;
  source?: string;
}) {
  await requireSuperadmin();
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const page = Math.max(1, input.page ?? 1);
  const source = input.source?.trim().slice(0, 80) ?? "";
  const { directory, retentionDays } = serviceLogConfig();
  await clearExpiredLogs(directory, retentionDays);

  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch {
    names = [];
  }
  const files = names
    .filter((name) => /^service-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort()
    .reverse();
  const items: ServiceLog[] = [];
  for (const name of files) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const log = asLog(JSON.parse(line));
        if (log && (!source || log.source === source)) items.push(log);
      } catch {
        continue;
      }
    }
  }
  items.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  const from = (page - 1) * pageSize;
  return {
    items: items.slice(from, from + pageSize),
    total: items.length,
    page,
    pageSize,
    retentionDays,
  };
}
