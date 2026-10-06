/**
 * db:seed — seeds the database with default languages, applications,
 * and a default admin user account.
 *
 * Usage:
 *   npm run db:seed
 */

import postgres from "postgres";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

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
