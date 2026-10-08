/**
 * db:reset — drops everything in the public schema. That's it.
 *
 * After this, run manually:
 *   npm run db:migrate   ← rebuild all tables
 *   npm run db:seed      ← load default data
 *
 * ⚠  DESTRUCTIVE — local / staging use only. Never run against production.
 *
 * Usage:
 *   npm run db:reset
 *   LINGO_RESET_CONFIRM=yes npm run db:reset
 */

import postgres from "postgres";

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

async function reset() {
  console.log("🗑   Dropping everything in public schema...");
  await sql.unsafe(`drop schema public cascade; create schema public;`);

  // Restore grants lost when the schema was recreated
  await sql.unsafe(`
    grant usage on schema public to postgres, anon, authenticated, service_role;
    grant all on all tables in schema public to postgres, anon, authenticated, service_role;
    grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
    grant all on all routines in schema public to postgres, anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on tables to postgres, anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on sequences to postgres, anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on routines to postgres, anon, authenticated, service_role;
  `);
  console.log("   ✔  Done\n");
  console.log("Next steps:");
  console.log("  npm run db:migrate");
  console.log("  npm run db:seed");
  await sql.end();
}

reset().catch((err) => {
  console.error("Reset failed:", err.message ?? err);
  process.exit(1);
});
