/**
 * db:reset — drops all Lingo tables, re-applies every migration in order,
 * then seeds the database.
 *
 * ⚠  DESTRUCTIVE — local / staging use only. Never run against production.
 *
 * Usage:
 *   npm run db:reset
 *   # or with confirm flag inline:
 *   LINGO_RESET_CONFIRM=yes npm run db:reset
 */

import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.LINGO_RESET_CONFIRM !== "yes") {
  console.error(
    "⚠️   db:reset will DESTROY all Lingo data!\n" +
    "    Add  LINGO_RESET_CONFIRM=yes  to .env.local (or prefix the command) to confirm.\n\n" +
    "    Example:  LINGO_RESET_CONFIRM=yes npm run db:reset"
  );
  process.exit(1);
}

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

const DROP_SQL = `
  drop table if exists article_comments             cascade;
  drop table if exists application_members          cascade;
  drop table if exists content_translation_versions cascade;
  drop table if exists content_translations         cascade;
  drop table if exists content                      cascade;
  drop table if exists translation_versions         cascade;
  drop table if exists translations                 cascade;
  drop table if exists translation_keys             cascade;
  drop table if exists namespaces                   cascade;
  drop table if exists applications                 cascade;
  drop table if exists languages                    cascade;
  drop table if exists hub_users                    cascade;
  drop function if exists uuidv7()                  cascade;
  drop function if exists set_updated_at()          cascade;
`;

async function reset() {
  const migrationsDir = join(__dirname, "../supabase/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log("🗑   Dropping all Lingo tables...");
  await sql.unsafe(DROP_SQL);
  console.log("   ✔  Dropped\n");

  for (const file of files) {
    console.log(`📄  Applying migration: ${file}`);
    const migrationSql = readFileSync(join(migrationsDir, file), "utf8");
    await sql.unsafe(migrationSql);
    console.log(`   ✔  Done`);
  }

  console.log("\n🌱  Running seed...");
  execSync("npm run db:seed", {
    stdio: "inherit",
    cwd: join(__dirname, ".."),
  });

  console.log("\n✅  Reset complete.");
  await sql.end();
}

reset().catch((err) => {
  console.error("Reset failed:", err.message ?? err);
  process.exit(1);
});
