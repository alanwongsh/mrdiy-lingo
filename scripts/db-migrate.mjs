/**
 * db:migrate — applies all SQL migration files in supabase/migrations/ in order.
 * Safe to re-run; migrations use "create if not exists" / "on conflict do nothing".
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
  const migrationsDir = join(__dirname, "../supabase/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found in supabase/migrations/");
    await sql.end();
    return;
  }

  console.log(`📦  Found ${files.length} migration file(s)\n`);

  for (const file of files) {
    console.log(`📄  Applying: ${file}`);
    const migrationSql = readFileSync(join(migrationsDir, file), "utf8");
    await sql.unsafe(migrationSql);
    console.log(`   ✔  Done`);
  }

  console.log("\n✅  All migrations applied.");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
});
