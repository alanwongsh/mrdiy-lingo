import { NextResponse } from "next/server";
import { applyActorCookie, signActorToken } from "@/lib/auth/actor";

export async function POST(request: Request) {
  if (process.env.EMBED_ALLOW_DEV !== "true") {
    return new Response("Dev sign-in is disabled.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim();
  const name = String(form.get("name") ?? "").trim() || username;
  if (!username || username.length > 80 || name.length > 120) {
    return new Response("Enter a username.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let session: string;
  try {
    session = signActorToken({ username, name, email: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    return new Response(message, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  applyActorCookie(response, session, request.url);
  return response;
}
