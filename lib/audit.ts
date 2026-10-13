import { cache } from "react";
import { getActor } from "@/lib/auth/actor";
import { getCurrentUser } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { writeServiceLog } from "@/lib/service-log";
import type { ContentAuditEventKind } from "@/lib/types";

export const SYSTEM_ACTOR = "System";

export type ArticleAuditInput = {
  contentId: string;
  event: ContentAuditEventKind;
  /** Looked up from the article when omitted. Pass it for a delete, after which the row is gone. */
  applicationId?: string;
  title?: string;
  languageCode?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  detail?: Record<string, unknown>;
};

/**
 * One id per request, so the timeline can show a save and the changes it caused as one entry.
 * Outside a request (the publish timer) each call gets its own id.
 */
export const currentActionId = cache((): string => crypto.randomUUID());

type Who = {
  actor_username: string | null;
  actor_name: string;
  actor_user_id: string | null;
};

/** The signed-in person, or System when the cron publisher runs without one. */
async function currentWho(): Promise<Who> {
  try {
    const actor = await getActor();
    if (!actor) {
      return { actor_username: null, actor_name: SYSTEM_ACTOR, actor_user_id: null };
    }
    const user = await getCurrentUser().catch(() => null);
    return {
      actor_username: actor.username,
      actor_name: actor.name,
      actor_user_id: user?.id ?? null,
    };
  } catch {
    // A timer has no request, so there are no cookies to read.
    return { actor_username: null, actor_name: SYSTEM_ACTOR, actor_user_id: null };
  }
}

/**
 * Append audit rows for article changes. Call after the change is saved.
 * A failure is logged and does not undo or fail the change it describes.
 */
export async function recordArticleEvents(events: ArticleAuditInput[]): Promise<void> {
  const rows = events.filter((event) => event.contentId);
  if (rows.length === 0) return;
  try {
    const db = await getDb();
    const missing = [
      ...new Set(
        rows
          .filter((event) => !event.applicationId || event.title === undefined)
          .map((event) => event.contentId)
      ),
    ];
    const articles = new Map<string, { application_id: string; title: string }>();
    if (missing.length > 0) {
      const { data, error } = await db
        .from("content")
        .select("id, application_id, title")
        .in("id", missing);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        articles.set(String(row.id), {
          application_id: String(row.application_id),
          title: String(row.title ?? ""),
        });
      }
    }

    const who = await currentWho();
    const actionId = currentActionId();
    const insert = rows.flatMap((event) => {
      const article = articles.get(event.contentId);
      const applicationId = event.applicationId ?? article?.application_id;
      if (!applicationId) return [];
      return [
        {
          content_id: event.contentId,
          application_id: applicationId,
          content_title: event.title ?? article?.title ?? "",
          event: event.event,
          language_code: event.languageCode ?? null,
          from_status: event.fromStatus ?? null,
          to_status: event.toStatus ?? null,
          detail: { ...event.detail, action_id: actionId },
          ...who,
        },
      ];
    });
    if (insert.length === 0) return;
    const { error } = await db.from("content_audit_events").insert(insert);
    if (error) throw new Error(error.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store the audit event.";
    console.error(`[audit] ${message}`);
    await writeServiceLog({
      source: "audit",
      ok: false,
      message: "Article audit event was not stored.",
      error: message,
      metadata: { events: rows.map(({ contentId, event }) => ({ contentId, event })) },
    });
  }
}

export async function recordArticleEvent(event: ArticleAuditInput): Promise<void> {
  await recordArticleEvents([event]);
}

/** One STATUS_CHANGED row, or nothing when the status did not move. */
export async function recordStatusChange(
  contentId: string,
  fromStatus: string | null | undefined,
  toStatus: string,
  extra: Omit<ArticleAuditInput, "contentId" | "event" | "fromStatus" | "toStatus"> = {}
): Promise<void> {
  if (fromStatus === toStatus) return;
  await recordArticleEvent({
    ...extra,
    contentId,
    event: "STATUS_CHANGED",
    fromStatus: fromStatus ?? null,
    toStatus,
  });
}
