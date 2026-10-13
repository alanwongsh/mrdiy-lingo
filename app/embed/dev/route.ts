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
  const title = String(form.get("title") ?? "").trim() || null;
  const nextPath = safeNextPath(String(form.get("next") ?? "/"));
  if (!email?.includes("@")) {
    return new Response("Enter an email. Joget sign-in is blocked without one.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!username) {
    return new Response("Enter a username.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let session: string;
  try {
    session = signActorToken({ username, name, email, employeeId, title });
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
