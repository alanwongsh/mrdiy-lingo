import { getDb } from "@/lib/db/client";
import {
  applyActorCookie,
  redirectToPath,
  safeNextPath,
  signActorToken,
} from "@/lib/auth/actor";
import { verifyPassword } from "@/lib/auth/password";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const nextPath = safeNextPath(String(form.get("next") ?? "/"));
  const failed = redirectToPath(
    `/sign-in?error=1&next=${encodeURIComponent(nextPath)}`,
    request.url
  );

  if (!email || !password || password.length > 200) {
    return failed;
  }

  const db = await getDb();
  const { data, error } = await db
    .from("hub_users")
    .select("username, employee_id, email, display_name, password_hash")
    .ilike("email", email)
    .maybeSingle();

  if (error) {
    const missing = error.code === "42703" || /password_hash/i.test(error.message);
    return new Response(
      missing
        ? "Run migration 009_password_sign_in.sql from Setup."
        : "Sign-in failed.",
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const passwordOk = await verifyPassword(password, data?.password_hash ?? null);
  if (!data || !passwordOk) return failed;

  const username =
    data.username?.trim() ||
    data.employee_id?.trim() ||
    email.split("@")[0] ||
    "";
  const name = data.display_name?.trim() || username;
  if (!username) return failed;

  let session: string;
  try {
    session = signActorToken({
      username,
      name,
      email: data.email,
      employeeId: data.employee_id,
    });
  } catch (signError) {
    const message = signError instanceof Error ? signError.message : "Sign-in failed.";
    return new Response(message, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const response = redirectToPath(nextPath, request.url);
  applyActorCookie(response, session, request.url);
  return response;
}
