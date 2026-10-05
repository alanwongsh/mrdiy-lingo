"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/actor";
import { requireContentAccess } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import type { ArticleComment } from "@/lib/types";

export async function listArticleComments(
  contentId: string
): Promise<ArticleComment[]> {
  await requireContentAccess(contentId, "view");
  const db = await getDb();
  const { data, error } = await db
    .from("article_comments")
    .select("*")
    .eq("content_id", contentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ArticleComment[];
}

export async function addArticleComment(input: {
  contentId: string;
  applicationId: string;
  body: string;
  languageCode?: string | null;
}): Promise<void> {
  const grant = await requireContentAccess(input.contentId, "view");
  const actor = await requireActor();
  const body = input.body.trim();
  if (!body) throw new Error("Write a comment first.");
  if (body.length > 2000) throw new Error("Comment is too long.");

  const languageCode = input.languageCode?.trim() || null;
  if (languageCode && !/^[A-Za-z0-9-]{2,15}$/.test(languageCode)) {
    throw new Error("Unknown language.");
  }

  const db = await getDb();
  const { data: article, error: findError } = await db
    .from("content")
    .select("id, application_id")
    .eq("id", input.contentId)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!article || article.application_id !== input.applicationId) {
    throw new Error("Article not found.");
  }

  const { error } = await db.from("article_comments").insert({
    content_id: input.contentId,
    language_code: languageCode,
    body,
    author_username: actor.username,
    author_name: actor.name,
    author_user_id: grant.user.id,
  });
  if (error) throw new Error(error.message);

  revalidatePath(
    `/applications/${input.applicationId}/articles/${input.contentId}`
  );
}
