import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACTOR_COOKIE,
  isAnonymousPath,
  safeNextPath,
  verifyActorToken,
} from "@/lib/auth/actor";
import "@/lib/supabase/env";

function continueRequest(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-lingo-path", request.nextUrl.pathname);
  requestHeaders.set("x-lingo-search", request.nextUrl.search);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

function redirectToSignIn(request: NextRequest) {
  const next = safeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  const destination =
    next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(new URL(destination, request.url));
}

export async function updateSession(request: NextRequest) {
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
