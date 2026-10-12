import { redirect } from "next/navigation";

/** Review emails moved to the General tab. */
export default async function SettingsNotificationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/applications/${id}/settings/general#notifications`);
}
