import { authorizedCronRequest } from "@/lib/cron/auth";
import { deliverPendingNotifications } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await deliverPendingNotifications();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification sender failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
