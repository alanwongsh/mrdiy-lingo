"use server";

import { requireContentAccess } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import type { ContentAuditEvent } from "@/lib/types";

export async function listArticleAuditEvents(
  contentId: string
): Promise<ContentAuditEvent[]> {
  await requireContentAccess(contentId, "view");
  const db = await getDb();
  const { data, error } = await db
    .from("content_audit_events")
    .select("*")
    .eq("content_id", contentId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) {
    if (error.code === "42P01" || /content_audit_events/i.test(error.message)) {
      throw new Error("Run migration 023_content_audit_events.sql from Setup");
    }
    throw new Error(error.message);
  }
  return (data ?? []) as ContentAuditEvent[];
}
