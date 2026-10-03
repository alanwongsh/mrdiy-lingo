/**
 * Corporate networks often intercept HTTPS with a custom CA that Node does not trust.
 * Set SUPABASE_INSECURE_SSL=true in .env.local (development only) if you see "fetch failed".
 */
if (
  process.env.NODE_ENV === "development" &&
  process.env.SUPABASE_INSECURE_SSL === "true"
) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export function assertSupabaseEnv() {
  if (!process.env.NEXT_PRIVATE_SUPABASE_URL) {
    throw new Error("Missing NEXT_PRIVATE_SUPABASE_URL in .env.local");
  }
  if (!process.env.NEXT_PRIVATE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Missing NEXT_PRIVATE_SUPABASE_PUBLISHABLE_KEY in .env.local");
  }
}
