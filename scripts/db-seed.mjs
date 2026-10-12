/**
 * db:seed — seeds the database with:
 *   - Default languages
 *   - Default applications (Product + Press)
 *   - Test users with different roles
 *
 * Superadmin email/name/password can be overridden via .env.local:
 *   LINGO_SEED_ADMIN_EMAIL
 *   LINGO_SEED_ADMIN_NAME
 *   LINGO_SEED_ADMIN_PASSWORD
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
  ssl:
    process.env.SUPABASE_INSECURE_SSL === "true"
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

// ── Read from env or fall back to defaults ────────────────────────────────────
const ADMIN_EMAIL    = process.env.LINGO_SEED_ADMIN_EMAIL?.trim()    || "superadmin@mrdiy.com";
const ADMIN_NAME     = process.env.LINGO_SEED_ADMIN_NAME?.trim()     || "Super Admin";
const ADMIN_PASSWORD = process.env.LINGO_SEED_ADMIN_PASSWORD?.trim() || "Admin@123!";

// Test users — superadmin comes from env, others are fixed test accounts
const users = [
  {
    email: ADMIN_EMAIL,
    display_name: ADMIN_NAME,
    is_superadmin: true,
    role: null, // superadmin bypasses all app roles
  },
  {
    email: "admin@mrdiy.com",
    display_name: "App Admin",
    is_superadmin: false,
    role: "ADMIN", // edit + approve + manage app
  },
  {
    email: "hod@mrdiy.com",
    display_name: "HOD User",
    is_superadmin: false,
    role: "HOD",   // edit + approve
  },
  {
    email: "editor@mrdiy.com",
    display_name: "Editor User",
    is_superadmin: false,
    role: "EDITOR", // edit/draft only
  },
];

async function seed() {
  // ── Languages ──────────────────────────────────────────────────────────────
  console.log("🌱  Seeding languages...");
  for (const lang of languages) {
    await sql`
      insert into languages (code, name, status)
      values (${lang.code}, ${lang.name}, ${lang.status})
      on conflict (code) do nothing
    `;
  }
  console.log(`   ✔  ${languages.length} languages`);

  // ── Applications ───────────────────────────────────────────────────────────
  console.log("🌱  Seeding applications...");
  const appIds = {};
  for (const app of applications) {
    const [existing] = await sql`
      select id from applications where name = ${app.name}
    `;
    if (existing) {
      appIds[app.name] = existing.id;
    } else {
      const [inserted] = await sql`
        insert into applications (name, description, status, model_type)
        values (${app.name}, ${app.description}, ${app.status}, ${app.model_type})
        returning id
      `;
      appIds[app.name] = inserted.id;
    }
  }
  console.log(`   ✔  ${applications.length} applications`);

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log(`🌱  Seeding users (password: ${ADMIN_PASSWORD})...`);
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  for (const user of users) {
    const [row] = await sql`
      insert into hub_users (email, display_name, is_superadmin, password_hash)
      values (${user.email}, ${user.display_name}, ${user.is_superadmin}, ${passwordHash})
      on conflict (lower(email)) where email is not null
      do update set
        display_name  = excluded.display_name,
        is_superadmin = excluded.is_superadmin,
        password_hash = excluded.password_hash
      returning id
    `;

    console.log(
      `   ✔  ${user.display_name} (${user.email}) — ${
        user.is_superadmin ? "Superadmin" : `Role: ${user.role}`
      }`
    );

    // Add non-superadmin users to all applications with their role
    if (!user.is_superadmin && user.role) {
      const canApprove = user.role === "HOD" || user.role === "ADMIN";
      for (const [appName, appId] of Object.entries(appIds)) {
        await sql`
          insert into application_members (application_id, user_id, role, can_edit, can_approve)
          values (${appId}, ${row.id}, ${user.role}, true, ${canApprove})
          on conflict (application_id, user_id)
          do update set
            role        = excluded.role,
            can_edit    = excluded.can_edit,
            can_approve = excluded.can_approve
        `;
      }
      console.log(`      → Added to: ${Object.keys(appIds).join(", ")}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`
✅  Seed complete!

📋  Test accounts (password: ${ADMIN_PASSWORD})
┌──────────────────────────────┬────────────────┬───────────────────────────────┐
│ Email                        │ Role           │ Can do                        │
├──────────────────────────────┼────────────────┼───────────────────────────────┤
│ ${ADMIN_EMAIL.padEnd(28)}  │ Superadmin     │ Everything, all apps          │
│ admin@mrdiy.com              │ Admin          │ Edit + approve + manage app   │
│ hod@mrdiy.com                │ HOD            │ Edit + approve translations   │
│ editor@mrdiy.com             │ Editor         │ Edit/draft only               │
└──────────────────────────────┴────────────────┴───────────────────────────────┘

💡  Override superadmin in .env.local:
    LINGO_SEED_ADMIN_EMAIL=your.email@mrdiy.com
    LINGO_SEED_ADMIN_NAME=Your Name
    LINGO_SEED_ADMIN_PASSWORD=YourPassword123!
  `);

  await sql.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
