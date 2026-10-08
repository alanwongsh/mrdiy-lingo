/**
 * db:migrate — applies SQL migration files in supabase/migrations/ in order.
 * Tracks applied migrations in a _migrations table so each file runs only once.
 *
 * Usage:
 *   npm run db:migrate
 */

import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Missing DATABASE_URL in .env.local");
  process.exit(1);
}

const sql = postgres(connectionString, {
  ssl: process.env.SUPABASE_INSECURE_SSL === "true" ? { rejectUnauthorized: false } : true,
  max: 1,
  onnotice: () => {},
});

async function migrate() {
  // Create tracking table if it doesn't exist
  await sql.unsafe(`
    create table if not exists _migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const migrationsDir = join(__dirname, "../supabase/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found in supabase/migrations/");
    await sql.end();
    return;
  }

  // Fetch already-applied migrations
  const applied = await sql`select filename from _migrations`;
  const appliedSet = new Set(applied.map((r) => r.filename));

  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log("✅  Nothing to apply — all migrations are up to date.");
    await sql.end();
    return;
  }

  console.log(`📦  ${pending.length} pending migration(s)\n`);

  for (const file of pending) {
    console.log(`📄  Applying: ${file}`);
    const migrationSql = readFileSync(join(migrationsDir, file), "utf8");
    await sql.unsafe(migrationSql);
    await sql`insert into _migrations (filename) values (${file})`;
    console.log(`   ✔  Done`);
  }

  console.log("\n✅  All migrations applied.");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
});
