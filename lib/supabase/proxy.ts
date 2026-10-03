import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import "@/lib/supabase/env";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

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
          supabaseResponse = NextResponse.next({
            request,
          });
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
