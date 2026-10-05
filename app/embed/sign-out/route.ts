import { clearActorCookie, redirectToPath } from "@/lib/auth/actor";

export async function GET(request: Request) {
  const response = redirectToPath("/sign-in", request.url, 307);
  clearActorCookie(response, request.url);
  return response;
}
