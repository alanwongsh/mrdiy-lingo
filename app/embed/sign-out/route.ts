import { clearActorCookie, clearEmbedCookie, redirectToPath } from "@/lib/auth/actor";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) {
    return new Response("Bad origin.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const response = redirectToPath("/sign-in", request.url, 303);
  clearActorCookie(response, request.url);
  clearEmbedCookie(response, request.url);
  return response;
}
