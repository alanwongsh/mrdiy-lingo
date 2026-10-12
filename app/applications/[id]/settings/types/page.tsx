import { redirect } from "next/navigation";

/** Article types moved to the General tab. */
export default async function SettingsTypesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/applications/${id}/settings/general#types`);
}
