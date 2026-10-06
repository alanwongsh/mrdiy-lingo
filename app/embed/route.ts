import { actorForStoredEmail } from "@/lib/auth/access";
import {
  applyActorCookie,
  applyEmbedCookie,
  clearEmbedCookie,
  devEmbedEnabled,
  requestInFrame,
  redirectToPath,
  signActorToken,
  verifyActorToken,
  type HubActor,
} from "@/lib/auth/actor";

function plain(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenActor = verifyActorToken(url.searchParams.get("token") ?? "");
  const email = url.searchParams.get("email")?.trim() ?? "";
  let actor: HubActor | null = tokenActor;
  if (!actor && email) {
    if (!devEmbedEnabled()) {
      return plain("Dev sign-in is disabled.", 403);
    }
    try {
      actor = await actorForStoredEmail(email);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign-in failed.";
      return plain(message, 500);
    }
    if (!actor) {
      return plain("No account is stored for that email.", 401);
    }
  }
  if (!actor) {
    return plain(
      "This Joget link is invalid or expired. Reload the page in Joget.",
      401
    );
  }

  let session: string;
  try {
    session = signActorToken(actor);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    return plain(message, 500);
  }

  const response = redirectToPath(url.searchParams.get("next") ?? "/", request.url, 307);
  const inFrame = requestInFrame(request);
  applyActorCookie(response, session, request.url, inFrame);
  if (inFrame) applyEmbedCookie(response, request.url);
  else clearEmbedCookie(response, request.url);
  return response;
}
