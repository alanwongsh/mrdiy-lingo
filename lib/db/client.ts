import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { assertSupabaseEnv } from "@/lib/supabase/env";

function createBackgroundClient() {
  assertSupabaseEnv();
  return createSupabaseClient(
    process.env.NEXT_PRIVATE_SUPABASE_URL!,
    process.env.NEXT_PRIVATE_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function getDb() {
  try {
    return await createClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/cookies|request scope/i.test(message)) return createBackgroundClient();
    throw error;
  }
}

export function escapeIlike(term: string): string {
  return term.replace(/[%_]/g, (m) => `\\${m}`);
}
