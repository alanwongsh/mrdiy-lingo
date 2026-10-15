/**
 * True on the live site. Gate features that are not ready to go live with this.
 * Reads APP_ENV (production, staging, development, ...). Without APP_ENV, any
 * production build counts, so set APP_ENV=staging on staging.
 */
export function isProduction(): boolean {
  const appEnv = process.env.APP_ENV?.trim().toLowerCase();
  if (appEnv) return appEnv === "production";
  return process.env.NODE_ENV === "production";
}
