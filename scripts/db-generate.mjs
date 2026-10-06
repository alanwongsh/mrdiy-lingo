/**
 * db:generate — generates TypeScript types from the live Supabase schema
 * into lib/database.types.ts using the Supabase CLI.
 *
 * Usage:
 *   npm run db:generate
 *
 * Requires: npx supabase (installed automatically via npx)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out  = join(root, "lib", "database.types.ts");

// Derive project ref from SUPABASE_PROJECT_REF or extract from DATABASE_URL
let projectRef = process.env.SUPABASE_PROJECT_REF?.trim();

if (!projectRef) {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) {
    // e.g. postgresql://postgres.abcdefghij:<pass>@...
    const match = dbUrl.match(/postgres\.([a-z0-9]+):/i);
    if (match) projectRef = match[1];
  }
}

if (!projectRef) {
  // Try to extract from Supabase URL: https://<ref>.supabase.co
  const supabaseUrl = process.env.NEXT_PRIVATE_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    const match = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
    if (match) projectRef = match[1];
  }
}

if (!projectRef) {
  console.error(
    "Could not determine project ref.\n" +
    "Set SUPABASE_PROJECT_REF in .env.local, or ensure DATABASE_URL / NEXT_PRIVATE_SUPABASE_URL is set."
  );
  process.exit(1);
}

const cmd = `npx supabase gen types typescript --project-id ${projectRef}`;
console.log(`⚙️   Generating types for project: ${projectRef}`);
console.log(`    Command: ${cmd}\n`);

try {
  const output = execSync(cmd, { cwd: root, encoding: "utf8" });
  writeFileSync(out, output, "utf8");
  console.log(`✅  Types written to lib/database.types.ts`);
} catch (err) {
  console.error("Type generation failed:", err.message ?? err);
  process.exit(1);
}
