import { runDuePublications } from "@/lib/publish/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization");
  if (secret) return header === `Bearer ${secret}`;
  return process.env.VERCEL === "1" && request.headers.get("user-agent") === "vercel-cron/1.0";
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDuePublications();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish scheduler failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
