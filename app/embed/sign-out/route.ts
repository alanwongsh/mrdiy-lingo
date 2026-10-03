import { NextResponse } from "next/server";
import { clearActorCookie } from "@/lib/auth/actor";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));
  clearActorCookie(response, request.url);
  return response;
}
