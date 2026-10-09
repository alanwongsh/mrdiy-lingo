import { getDb } from "@/lib/db/client";
import { resolveAppAccess } from "@/lib/auth/access";
import { mailConfigured, sendMail } from "@/lib/mail";
import type { HubUser } from "@/lib/types";

export type OutboxRunResult = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
  notes: string[];
};

type OutboxRow = {
  id: string;
  kind: "ARTICLE_REVIEW";
  content_id: string;
  attempts: number;
  sent_to: string[] | null;
};

type ReviewArticle = {
  id: string;
  application_id: string;
  title: string;
  status: string;
  submitted_by_name: string | null;
  application: { id: string; name: string; owner_user_id: string | null } | null;
};

const BATCH = 20;
const MAX_ATTEMPTS = 5;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function articleUrl(article: ReviewArticle): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/applications/${article.application_id}/articles/${article.id}`;
}

/** Owner and members who can approve in this application, by the same rules as the app. */
async function approverEmails(
  application: NonNullable<ReviewArticle["application"]>
): Promise<string[]> {
  const db = await getDb();
  const { data: members, error } = await db
    .from("application_members")
    .select("user_id")
    .eq("application_id", application.id);
  if (error) throw new Error(error.message);
  const ids = [
    ...new Set(
      [...(members ?? []).map((row) => row.user_id as string), application.owner_user_id].filter(
        (id): id is string => !!id
      )
    ),
  ];
  if (ids.length === 0) return [];

  const { data: users, error: usersError } = await db
    .from("hub_users")
    .select("*")
    .in("id", ids);
  if (usersError) throw new Error(usersError.message);

  const emails = new Set<string>();
  for (const user of (users ?? []) as HubUser[]) {
    const access = await resolveAppAccess(user, application);
    if (!access?.can_approve) continue;
    const email = user.email?.trim().toLowerCase();
    if (email) emails.add(email);
    else console.warn(`[notifications] Approver ${user.id} has no email address; skipped.`);
  }
  return [...emails];
}

function reviewMessage(article: ReviewArticle) {
  const appName = article.application?.name ?? "Lingo";
  const submitter = article.submitted_by_name?.trim();
  const url = articleUrl(article);
  const subject = `Review needed: ${article.title}`;
  const text = [
    `"${article.title}" is ready for review in ${appName}.`,
    submitter ? `Submitted by ${submitter}.` : "",
    url ? `Open it: ${url}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const html = [
    `<p><strong>${escapeHtml(article.title)}</strong> is ready for review in ${escapeHtml(appName)}.</p>`,
    submitter ? `<p>Submitted by ${escapeHtml(submitter)}.</p>` : "",
    url ? `<p><a href="${escapeHtml(url)}">Open the article</a></p>` : "",
  ].join("");
  return { subject, text, html };
}

async function settle(id: string, patch: Record<string, unknown>) {
  const db = await getDb();
  const { error } = await db
    .from("notification_outbox")
    .update({ locked_at: null, ...patch })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function deliverReviewNotice(row: OutboxRow, result: OutboxRunResult) {
  const db = await getDb();
  const { data, error } = await db
    .from("content")
    .select(
      "id, application_id, title, status, submitted_by_name, application:applications(id, name, owner_user_id)"
    )
    .eq("id", row.content_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const article = data as unknown as ReviewArticle | null;

  // Approved or sent back before the queue got to it: nothing left to review.
  if (!article?.application || article.status !== "REVIEW") {
    await settle(row.id, { status: "SKIPPED", last_error: "Article is no longer in review." });
    result.skipped += 1;
    return;
  }

  const alreadySent = new Set(row.sent_to ?? []);
  const recipients = (await approverEmails(article.application)).filter(
    (email) => !alreadySent.has(email)
  );
  if (recipients.length === 0 && alreadySent.size === 0) {
    await settle(row.id, { status: "SKIPPED", last_error: "No approver has an email address." });
    result.skipped += 1;
    return;
  }

  const message = reviewMessage(article);
  const sentTo = [...alreadySent];
  const errors: string[] = [];
  for (const to of recipients) {
    try {
      await sendMail({ to, ...message });
      sentTo.push(to);
    } catch (sendError) {
      errors.push(`${to}: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
    }
  }

  if (errors.length === 0) {
    await settle(row.id, {
      status: "SENT",
      sent_to: sentTo,
      last_error: null,
      sent_at: new Date().toISOString(),
    });
    result.sent += 1;
    return;
  }
  const giveUp = row.attempts >= MAX_ATTEMPTS;
  await settle(row.id, {
    status: giveUp ? "FAILED" : "PENDING",
    sent_to: sentTo,
    last_error: errors.join("\n").slice(0, 2000),
  });
  if (giveUp) result.failed += 1;
  else result.retrying += 1;
}

export async function deliverPendingNotifications(): Promise<OutboxRunResult> {
  const result: OutboxRunResult = {
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
    notes: [],
  };
  // Leave the queue alone until SMTP is set, so nothing burns its attempts.
  if (!mailConfigured()) {
    result.notes.push("SMTP is not configured; queue left untouched.");
    return result;
  }

  const db = await getDb();
  const { data, error } = await db.rpc("claim_notification_outbox", { p_limit: BATCH });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as OutboxRow[];
  result.claimed = rows.length;

  for (const row of rows) {
    try {
      await deliverReviewNotice(row, result);
    } catch (rowError) {
      const message = rowError instanceof Error ? rowError.message : String(rowError);
      result.notes.push(`${row.id}: ${message}`);
      const giveUp = row.attempts >= MAX_ATTEMPTS;
      await settle(row.id, {
        status: giveUp ? "FAILED" : "PENDING",
        last_error: message.slice(0, 2000),
      }).catch(() => {});
      if (giveUp) result.failed += 1;
      else result.retrying += 1;
    }
  }
  return result;
}
