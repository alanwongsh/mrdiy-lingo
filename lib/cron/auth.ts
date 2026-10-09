/** Cron callers (pg_cron via pg_net, or Vercel Cron) send `Authorization: Bearer $CRON_SECRET`. */
export function authorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization");
  if (secret) return header === `Bearer ${secret}`;
  return process.env.VERCEL === "1" && request.headers.get("user-agent") === "vercel-cron/1.0";
}
