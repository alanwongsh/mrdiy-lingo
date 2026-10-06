import { applyActorCookie, devEmbedEnabled, redirectToPath, safeNextPath, signActorToken } from "@/lib/auth/actor";

export async function POST(request: Request) {
  if (!devEmbedEnabled()) {
    return new Response("Dev sign-in is disabled.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const name = String(form.get("name") ?? "").trim() || username;
  const email = String(form.get("email") ?? "").trim() || null;
  const employeeId = String(form.get("employeeId") ?? "").trim() || null;
  const nextPath = safeNextPath(String(form.get("next") ?? "/"));
  if (!username) {
    return new Response("Enter a username.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let session: string;
  try {
    session = signActorToken({ username, name, email, employeeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    return new Response(message, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const response = redirectToPath(nextPath, request.url);
  applyActorCookie(response, session, request.url);
  return response;
}
