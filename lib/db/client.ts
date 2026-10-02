import { createClient } from "@/lib/supabase/server";

export async function getDb() {
  return createClient();
}

export function escapeIlike(term: string): string {
  return term.replace(/[%_]/g, (m) => `\\${m}`);
}
