import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SourceType } from "@/lib/types";
import { sourceTypeAuthor } from "@/lib/types";

export const ACTOR_COOKIE = "lingo_actor";
export const EMBED_COOKIE = "lingo_embed";

export function devEmbedEnabled(): boolean {
  return process.env.EMBED_ALLOW_DEV === "true";
}

const SESSION_SECONDS = 60 * 60 * 12;

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

type CookieWrite = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "none";
  partitioned?: boolean;
  path: string;
  maxAge: number;
};

// Chrome accepts Secure cookies on localhost, which is what SameSite=None requires.
export function crossSiteCookieAllowed(requestUrl: string): boolean {
  const url = new URL(requestUrl);
  if (url.protocol === "https:") return true;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function crossSiteBase(): Omit<CookieWrite, "partitioned"> {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}

export function actorCookieOptions(requestUrl: string, embedded = false): CookieWrite {
  const secure = new URL(requestUrl).protocol === "https:";
  // SameSite=Lax is not sent on in-iframe fetches, so switching tabs inside
  // Joget drops the session. Partitioned covers browsers that block third-party
  // cookies. A normal top-level visit must stay Lax, or this cookie is not sent
  // again on refresh.
  if (embedded && crossSiteCookieAllowed(requestUrl)) {
    return { ...crossSiteBase(), partitioned: true };
  }
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  };
}

function cookieHeader(name: string, value: string, options: CookieWrite): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    `SameSite=${options.sameSite === "none" ? "None" : "Lax"}`,
  ];
  if (options.secure) parts.push("Secure");
  if (options.partitioned) parts.push("Partitioned");
  return parts.join("; ");
}

function appendCookie(response: NextResponse, name: string, value: string, options: CookieWrite) {
  response.headers.append("Set-Cookie", cookieHeader(name, value, options));
}

export function requestInFrame(request: Request): boolean {
  return request.headers.get("sec-fetch-dest") === "iframe";
}

export function applyActorCookie(
  response: NextResponse,
  token: string,
  requestUrl: string,
  embedded = false
) {
  if (embedded && crossSiteCookieAllowed(requestUrl)) {
    // Only a real cross-site iframe gets SameSite=None. A partitioned cookie is
    // not sent on a normal tab, so the next in-app navigation looks signed out.
    const base = crossSiteBase();
    appendCookie(response, ACTOR_COOKIE, token, { ...base, partitioned: true });
    appendCookie(response, ACTOR_COOKIE, token, base);
    return;
  }
  response.cookies.set(ACTOR_COOKIE, token, actorCookieOptions(requestUrl, false));
}

export function applyEmbedCookie(response: NextResponse, requestUrl: string) {
  if (crossSiteCookieAllowed(requestUrl)) {
    const base = crossSiteBase();
    appendCookie(response, EMBED_COOKIE, "1", { ...base, partitioned: true });
    appendCookie(response, EMBED_COOKIE, "1", base);
    return;
  }
  response.cookies.set(EMBED_COOKIE, "1", actorCookieOptions(requestUrl, false));
}

function expiredCookieHeader(name: string, mode: "lax" | "none" | "partitioned", https: boolean) {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "Max-Age=0"];
  if (mode === "lax") {
    parts.push("SameSite=Lax");
    if (https) parts.push("Secure");
  } else {
    parts.push("SameSite=None", "Secure");
    if (mode === "partitioned") parts.push("Partitioned");
  }
  return parts.join("; ");
}

export function clearActorCookie(response: NextResponse, requestUrl: string) {
  const https = new URL(requestUrl).protocol === "https:";
  response.headers.append("Set-Cookie", expiredCookieHeader(ACTOR_COOKIE, "lax", https));
  if (crossSiteCookieAllowed(requestUrl)) {
    response.headers.append("Set-Cookie", expiredCookieHeader(ACTOR_COOKIE, "none", https));
    response.headers.append(
      "Set-Cookie",
      expiredCookieHeader(ACTOR_COOKIE, "partitioned", https)
    );
  }
}

export function clearEmbedCookie(response: NextResponse, requestUrl: string) {
  const https = new URL(requestUrl).protocol === "https:";
  response.headers.append("Set-Cookie", expiredCookieHeader(EMBED_COOKIE, "lax", https));
  if (crossSiteCookieAllowed(requestUrl)) {
    response.headers.append("Set-Cookie", expiredCookieHeader(EMBED_COOKIE, "none", https));
    response.headers.append(
      "Set-Cookie",
      expiredCookieHeader(EMBED_COOKIE, "partitioned", https)
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
    path.startsWith("/embed/") ||
    path.startsWith("/published/") ||
    path === "/api/cron/publish" ||
    path === "/api/cron/notifications"
  );
}
