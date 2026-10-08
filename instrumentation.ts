export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Vercel freezes the server between requests. Production uses the scheduled route instead.
  if (process.env.VERCEL) return;
  const { startPublishScheduler } = await import("@/lib/publish/scheduler");
  startPublishScheduler();
}
