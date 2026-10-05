import {
  applyActorCookie,
  applyEmbedCookie,
  redirectToPath,
  signActorToken,
  verifyActorToken,
} from "@/lib/auth/actor";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const actor = verifyActorToken(url.searchParams.get("token") ?? "");
  if (!actor) {
    return new Response(
      "This Joget link is invalid or expired. Reload the page in Joget.",
      { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  let session: string;
  try {
    session = signActorToken(actor);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    return new Response(message, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const response = redirectToPath(url.searchParams.get("next") ?? "/", request.url, 307);
  applyActorCookie(response, session, request.url, true);
  applyEmbedCookie(response, request.url);
  return response;
}
