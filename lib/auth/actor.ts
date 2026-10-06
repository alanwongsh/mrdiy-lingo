import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SourceType } from "@/lib/types";
import { sourceTypeAuthor } from "@/lib/types";

export const ACTOR_COOKIE = "lingo_actor";
export const EMBED_COOKIE = "lingo_embed";

export function devEmbedEnabled(): boolean {
  return process.env.EMBED_ALLOW_DEV === "true";
}const SESSION_SECONDS = 60 * 60 * 12;

export type HubActor = {
  username: string;
  name: string;
  email: string | null;
  employeeId?: string | null;
};

type TokenPayload = {
  u: string;
  n: string;
  e?: string;
  eid?: string;
  exp: number;
};

function embedSecret(): string {
  const secret = process.env.JOGET_EMBED_SECRET?.trim() ?? "";
  if (!secret) {
    throw new Error("JOGET_EMBED_SECRET is not set.");
  }
  return secret;
}

function signPayload(payload: string): string {
  return createHmac("sha256", embedSecret()).update(payload).digest("base64url");
}

export function signActorToken(
  actor: HubActor,
  ttlSeconds = SESSION_SECONDS
): string {
  const payload: TokenPayload = {
    u: actor.username,
    n: actor.name,
    e: actor.email ?? "",
    eid: actor.employeeId ?? "",
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signPayload(body)}`;
}

export function verifyActorToken(token: string): HubActor | null {
  const secret = process.env.JOGET_EMBED_SECRET?.trim() ?? "";
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }

  const username = typeof parsed.u === "string" ? parsed.u.trim() : "";
  const name = typeof parsed.n === "string" ? parsed.n.trim() : "";
  const email = typeof parsed.e === "string" ? parsed.e.trim() : "";
  const employeeId = typeof parsed.eid === "string" ? parsed.eid.trim() : "";
  if (!username || username.length > 80 || !name || name.length > 120) return null;
  if (employeeId.length > 80) return null;
  if (!Number.isFinite(parsed.exp)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp < now - 30) return null;
  if (parsed.exp > now + SESSION_SECONDS + 120) return null;

  return {
    username,
    name,
    email: email || null,
    employeeId: employeeId || null,
  };
}

export function actorCookieOptions(requestUrl: string, embedded = false) {
  const secure = new URL(requestUrl).protocol === "https:";
  // Partitioned + SameSite=None is only for the Joget iframe. On a normal
  // Vercel visit that cookie is not sent again on refresh, so the session dies.
  if (embedded && secure) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: "none" as const,
      partitioned: true,
      path: "/",
      maxAge: SESSION_SECONDS,
    };
  }
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}

export function applyActorCookie(
  response: NextResponse,
  token: string,
  requestUrl: string,
  embedded = false
) {
  response.cookies.set(ACTOR_COOKIE, token, actorCookieOptions(requestUrl, embedded));
}

export function applyEmbedCookie(response: NextResponse, requestUrl: string) {
  response.cookies.set(EMBED_COOKIE, "1", actorCookieOptions(requestUrl, true));
}

function expiredCookieHeader(name: string, requestUrl: string, embedded: boolean) {
  const options = { ...actorCookieOptions(requestUrl, embedded), maxAge: 0 };
  const parts = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    `SameSite=${options.sameSite === "none" ? "None" : "Lax"}`,
  ];
  if (options.secure) parts.push("Secure");
  if ("partitioned" in options && options.partitioned) parts.push("Partitioned");
  return parts.join("; ");
}

export function clearActorCookie(response: NextResponse, requestUrl: string) {
  response.headers.append(
    "Set-Cookie",
    expiredCookieHeader(ACTOR_COOKIE, requestUrl, false)
  );
  if (new URL(requestUrl).protocol === "https:") {
    response.headers.append(
      "Set-Cookie",
      expiredCookieHeader(ACTOR_COOKIE, requestUrl, true)
    );
  }
}

export function clearEmbedCookie(response: NextResponse, requestUrl: string) {
  response.headers.append(
    "Set-Cookie",
    expiredCookieHeader(EMBED_COOKIE, requestUrl, false)
  );
  if (new URL(requestUrl).protocol === "https:") {
    response.headers.append(
      "Set-Cookie",
      expiredCookieHeader(EMBED_COOKIE, requestUrl, true)
    );
  }
}

export async function getActor(): Promise<HubActor | null> {
  const jar = await cookies();
  const token = jar.get(ACTOR_COOKIE)?.value ?? "";
  return verifyActorToken(token);
}

export async function approvalStamp(
  status: string,
  userId?: string | null
): Promise<{
  approved_by_username: string | null;
  approved_by_name: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
}> {
  if (status !== "APPROVED") {
    return {
      approved_by_username: null,
      approved_by_name: null,
      approved_by_user_id: null,
      approved_at: null,
    };
  }
  const actor = await requireActor();
  return {
    approved_by_username: actor.username,
    approved_by_name: actor.name,
    approved_by_user_id: userId ?? null,
    approved_at: new Date().toISOString(),
  };
}

export async function requireActor(): Promise<HubActor> {
  const actor = await getActor();
  if (!actor) {
    throw new Error("Sign in to continue.");
  }
  return actor;
}

export async function versionAuthorFields(sourceType: SourceType): Promise<{
  author: string;
  modifier: string;
  author_username: string | null;
}> {
  const actor = await getActor();
  if (!actor) {
    const label = sourceTypeAuthor(sourceType);
    return { author: label, modifier: label, author_username: null };
  }
  return {
    author: actor.name,
    modifier: actor.name,
    author_username: actor.username,
  };
}

export function redirectToPath(path: string, requestUrl: string, status = 303) {
  const destination = safeNextPath(path);
  const response = NextResponse.redirect(new URL(destination, requestUrl), status);
  response.headers.set("Location", destination);
  return response;
}

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

export function isAnonymousPath(path: string): boolean {
  return (
    path === "/sign-in" ||
    path === "/setup" ||
    path.startsWith("/auth/") ||
    path === "/embed" ||
    path.startsWith("/embed/")
  );
}
