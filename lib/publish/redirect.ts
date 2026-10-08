import { getDb } from "@/lib/db/client";
import { isPublicHttpUrl } from "@/lib/publish/links";

export type PublicationRedirect =
  | { kind: "missing" }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "nolink" }
  | { kind: "redirect"; url: string };

export async function getPublicationRedirect(id: string): Promise<PublicationRedirect> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { kind: "missing" };
  const db = await getDb();
  const { data, error } = await db
    .from("content_publications")
    .select("status, external_url")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return { kind: "missing" };
  if (data.status === "FAILED") return { kind: "failed" };
  if (data.status !== "PUBLISHED") return { kind: "pending" };
  const url = typeof data.external_url === "string" ? data.external_url : "";
  if (!isPublicHttpUrl(url)) return { kind: "nolink" };
  return { kind: "redirect", url };
}
