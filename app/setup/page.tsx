import { readFile } from "fs/promises";
import path from "path";
import { canOpenSetup } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { Card, PageHeader, Badge } from "@/components/ui";

async function readMigration(name: string) {
  try {
    return await readFile(
      path.join(process.cwd(), "supabase/migrations", name),
      "utf8"
    );
  } catch {
    return `-- Could not load ${name}`;
  }
}

export default async function SetupPage() {
  const allowed = await canOpenSetup();
  if (!allowed) {
    return (
      <div>
        <PageHeader
          title="Setup"
          description="Platform setup is limited to a Lingo superadmin."
        />
      </div>
    );
  }

  let ready = false;
  let message = "";
  let needsMigration = "";
  try {
    const db = await getDb();
    const { error } = await db.from("applications").select("id").limit(1);
    if (error) throw new Error(error.message);
    ready = true;
    message = "Tables are reachable.";

    const probePublish = await db
      .from("content")
      .select("slug, published_at")
      .limit(1);
    if (probePublish.error) {
      needsMigration = "003_content_publishing.sql";
      message = "Core schema OK, but run migration 003 for publish fields.";
    } else {
      const probeTargets = await db
        .from("content")
        .select("target_languages")
        .limit(1);
      if (probeTargets.error) {
        needsMigration = "004_content_target_languages.sql";
        message =
          "Publish fields OK, but run migration 004 for target languages.";
      } else {
        const probeComments = await db
          .from("article_comments")
          .select("id")
          .limit(1);
        if (probeComments.error) {
          needsMigration = "005_article_comments.sql";
          message =
            "Target languages OK, but run migration 005 for comments and approver names.";
        } else {
          const probeAccess = await db.from("hub_users").select("id").limit(1);
          if (probeAccess.error) {
            needsMigration = "008_access_control.sql";
            message =
              "Comments OK, but run migration 008 for users and application access.";
          } else {
            const probePassword = await db
              .from("hub_users")
              .select("password_hash")
              .limit(1);
            if (probePassword.error) {
              needsMigration = "009_password_sign_in.sql";
              message =
                "Access control OK, but run migration 009 for email and password sign-in.";
            }
          }
        }
      }
    }
  } catch (e) {
    message = e instanceof Error ? e.message : "Schema missing";
  }

  const sql1 = await readMigration("001_translation_hub.sql");
  const sql2 = await readMigration("002_version_approval.sql");
  const sql3 = await readMigration("003_content_publishing.sql");
  const sql4 = await readMigration("004_content_target_languages.sql");
  const sql5 = await readMigration("005_article_comments.sql");
  const sql6 = await readMigration("006_uuidv7.sql");
  const sql7 = await readMigration("007_rewrite_uuidv7.sql");
  const sql8 = await readMigration("008_access_control.sql");
  const sql9 = await readMigration("009_password_sign_in.sql");

  return (
    <div>
      <PageHeader
        title="Setup"
        description="Apply the Mr DIY Lingo schema to your Supabase project."
      />
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={ready ? "good" : "warn"}>
            {ready ? "Connected" : "Needs migration"}
          </Badge>
          {needsMigration ? (
            <Badge tone="warn">Run {needsMigration}</Badge>
          ) : null}
          <span className="text-sm text-[var(--hub-muted)]">{message}</span>
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--hub-muted)]">
          <li>Open your Supabase project SQL Editor.</li>
          <li>Run migration 001 if tables are missing.</li>
          <li>Run migration 002 only if you previously added version approval columns.</li>
          <li>Run migration 003 for slug / schedule / published dates.</li>
          <li>Run migration 004 for per-article target languages.</li>
          <li>Run migration 005 for article comments and approver names.</li>
          <li>Run migration 006 so new ids are time-ordered UUID v7.</li>
          <li>
            Run migration 007 only to rewrite existing v4 ids. Saved article and
            application links change.
          </li>
          <li>Run migration 008 for users, owners, and invited access.</li>
          <li>Run migration 009 for email and password sign-in.</li>
          <li>Refresh this page.</li>
        </ol>
      </Card>

      <div className="space-y-4">
        {(
          [
            ["1", "001_translation_hub.sql", sql1],
            ["2", "002_version_approval.sql (cleanup only)", sql2],
            ["3", "003_content_publishing.sql", sql3],
            ["4", "004_content_target_languages.sql", sql4],
            ["5", "005_article_comments.sql", sql5],
            ["6", "006_uuidv7.sql", sql6],
            ["7", "007_rewrite_uuidv7.sql", sql7],
            ["8", "008_access_control.sql", sql8],
            ["9", "009_password_sign_in.sql", sql9],
          ] as const
        ).map(([n, name, sql]) => (
          <Card key={name} className="overflow-hidden">
            <div className="border-b border-[var(--hub-border)] px-4 py-3 text-sm font-medium">
              {n}) supabase/migrations/{name}
            </div>
            <pre className="max-h-[40vh] overflow-auto bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">
              {sql}
            </pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
