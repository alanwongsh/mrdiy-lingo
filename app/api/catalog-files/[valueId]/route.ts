import { requireItemValueAccess } from "@/lib/auth/access";
import { getDb } from "@/lib/db/client";
import { CATALOG_BUCKET } from "@/lib/catalog-store";

/** Opens a stored catalog file through a short-lived signed link. The bucket is private. */
export async function GET(
  request: Request,
  context: { params: Promise<{ valueId: string }> }
) {
  try {
    const { valueId } = await context.params;
    await requireItemValueAccess(valueId, "view");
    const db = await getDb();
    const { data, error } = await db
      .from("catalog_values")
      .select("file_path, file_name")
      .eq("id", valueId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.file_path) return new Response("No file.", { status: 404 });
    const download = new URL(request.url).searchParams.get("download") === "1";
    const { data: signed, error: signError } = await db.storage
      .from(CATALOG_BUCKET)
      .createSignedUrl(data.file_path, 300, download ? { download: data.file_name ?? true } : undefined);
    if (signError || !signed?.signedUrl) {
      return new Response(signError?.message ?? "File unavailable.", { status: 404 });
    }
    return Response.redirect(signed.signedUrl, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Not allowed.";
    return new Response(message, { status: /not found/i.test(message) ? 404 : 403 });
  }
}
