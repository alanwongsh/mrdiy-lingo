/**
 * db:seed — seeds the database with default languages, applications,
 * and a default admin user account.
 *
 * Safe to re-run — all inserts use ON CONFLICT so existing data is never wiped.
 * Auto-runs any pending migrations first so tables always exist.
 *
 * Usage:
 *   npm run db:seed
 */

import postgres from "postgres";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scryptAsync = promisify(scrypt);

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Missing DATABASE_URL in .env.local");
  process.exit(1);
}

const sql = postgres(connectionString, {
  ssl: process.env.SUPABASE_INSECURE_SSL === "true"
    ? { rejectUnauthorized: false }
    : true,
  max: 1,
  onnotice: () => {},
});

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt}$${hash.toString("base64url")}`;
}

// ── Auto-migrate ──────────────────────────────────────────────────────────────
// Runs any pending migrations before seeding so tables always exist,
// even if someone runs db:seed before db:migrate.

async function ensureMigrated() {
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

  const applied = await sql`select filename from _migrations`;
  const appliedSet = new Set(applied.map((r) => r.filename));
  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log("✅  Migrations already up to date.\n");
    return;
  }

  console.log(`📦  Running ${pending.length} pending migration(s) first...\n`);
  for (const file of pending) {
    console.log(`📄  Migrating: ${file}`);
    const migrationSql = readFileSync(join(migrationsDir, file), "utf8");
    await sql.unsafe(migrationSql);
    await sql`insert into _migrations (filename) values (${file})`;
    console.log(`   ✔  Done`);
  }
  console.log("");
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const languages = [
  { code: "en",      name: "English",            status: "ACTIVE" },
  { code: "ms",      name: "Bahasa Malaysia",     status: "ACTIVE" },
  { code: "th",      name: "Thai",                status: "ACTIVE" },
  { code: "id",      name: "Indonesian",          status: "ACTIVE" },
  { code: "zh-Hans", name: "Chinese Simplified",  status: "ACTIVE" },
  { code: "zh-Hant", name: "Chinese Traditional", status: "ACTIVE" },
];

const applications = [
  {
    name: "Product",
    description: "Product-related translations used by product applications.",
    status: "ACTIVE",
    model_type: "STRING",
  },
  {
    name: "Press",
    description: "News and article content that requires multilingual publishing.",
    status: "ACTIVE",
    model_type: "CONTENT",
  },
];

async function seed() {
  await ensureMigrated();

  console.log("🌱  Seeding languages...");
  for (const lang of languages) {
    await sql`
      insert into languages (code, name, status)
      values (${lang.code}, ${lang.name}, ${lang.status})
      on conflict (code) do nothing
    `;
  }
  console.log(`   ✔  ${languages.length} languages`);

  console.log("🌱  Seeding applications...");
  for (const app of applications) {
    await sql`
      insert into applications (name, description, status, model_type)
      values (${app.name}, ${app.description}, ${app.status}, ${app.model_type})
      on conflict (name) do nothing
    `;
  }
  console.log(`   ✔  ${applications.length} applications`);

  // ── Default admin user ────────────────────────────────────────────────────
  const adminEmail    = process.env.LINGO_SEED_ADMIN_EMAIL?.trim()    || "admin@mrdiy.com";
  const adminName     = process.env.LINGO_SEED_ADMIN_NAME?.trim()     || "Lingo Admin";
  const adminPassword = process.env.LINGO_SEED_ADMIN_PASSWORD?.trim() || "Admin@123!";

  console.log(`🌱  Seeding admin user: ${adminEmail}...`);
  const passwordHash = await hashPassword(adminPassword);

  await sql`
    insert into hub_users (email, display_name, is_superadmin, password_hash)
    values (${adminEmail}, ${adminName}, true, ${passwordHash})
    on conflict (lower(email)) where email is not null
    do update set
      display_name   = excluded.display_name,
      is_superadmin  = true,
      password_hash  = excluded.password_hash
  `;
  console.log(`   ✔  Admin seeded`);
  console.log(`   📧  Email:    ${adminEmail}`);
  console.log(`   🔑  Password: ${adminPassword}`);

  console.log("\n✅  Seed complete.");
  await sql.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
