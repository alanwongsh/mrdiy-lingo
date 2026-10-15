import { redirect } from "next/navigation";
import { isProduction } from "@/lib/env";

/** Publish connections moved to the Quality & publishing tab. */
export default async function SettingsPublishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/applications/${id}/settings/quality${isProduction() ? "" : "#publishing"}`);
}
