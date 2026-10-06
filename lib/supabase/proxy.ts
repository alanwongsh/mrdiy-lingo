import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACTOR_COOKIE,
  EMBED_COOKIE,
  actorCookieOptions,
  devEmbedEnabled,
  isAnonymousPath,
  safeNextPath,
  verifyActorToken,
} from "@/lib/auth/actor";
import "@/lib/supabase/env";

function continueRequest(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-lingo-path", request.nextUrl.pathname);
  requestHeaders.set("x-lingo-search", request.nextUrl.search);
  const embedded =
    request.nextUrl.searchParams.get("embed") === "true" ||
    request.cookies.get(EMBED_COOKIE)?.value === "1";
  if (embedded) requestHeaders.set("x-lingo-embed", "1");
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  if (request.nextUrl.searchParams.get("embed") === "true") {
    response.cookies.set(EMBED_COOKIE, "1", actorCookieOptions(request.url, true));
  }
  return response;
}

function redirectToSignIn(request: NextRequest) {
  const next = safeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  const destination =
    next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(new URL(destination, request.url));
}

function redirectDevEmail(request: NextRequest) {
  if (!devEmbedEnabled()) return null;
  const path = request.nextUrl.pathname;
  if (path === "/embed" || path.startsWith("/embed/")) return null;
  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email) return null;
  const nextUrl = request.nextUrl.clone();
  nextUrl.searchParams.delete("email");
  const next = safeNextPath(`${nextUrl.pathname}${nextUrl.search}`);
  const destination = new URL("/embed", request.url);
  destination.searchParams.set("email", email);
  if (next !== "/") destination.searchParams.set("next", next);
  return NextResponse.redirect(destination);
}

export async function updateSession(request: NextRequest) {
  const devEmail = redirectDevEmail(request);
  if (devEmail) return devEmail;

  const path = request.nextUrl.pathname;
  const actor = verifyActorToken(request.cookies.get(ACTOR_COOKIE)?.value ?? "");
  if (!actor && !isAnonymousPath(path)) {
    return redirectToSignIn(request);
  }

  let supabaseResponse = continueRequest(request);

  const supabase = createServerClient(
    process.env.NEXT_PRIVATE_SUPABASE_URL!,
    process.env.NEXT_PRIVATE_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = continueRequest(request);
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          );
        },
      },
    }
  );

  // Refreshes the Auth token. Do not run code between createServerClient
  // and getClaims() — that can cause random sign-outs.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
