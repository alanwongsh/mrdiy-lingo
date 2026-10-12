import { notFound, redirect } from "next/navigation";
import { getApplication, listApplicationPeople } from "@/lib/actions/applications";
import { getCurrentUser } from "@/lib/auth/access";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { ApplicationAccessPanel } from "@/components/application-access-panel";
import { SettingsChrome } from "@/components/settings-chrome";

export default async function SettingsPeoplePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();
  if (!app.access.can_manage) redirect(`/applications/${app.id}/settings/general`);

  let people: Awaited<ReturnType<typeof listApplicationPeople>>;
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    [people, user] = await Promise.all([listApplicationPeople(app.id), getCurrentUser()]);
  } catch (error) {
    return <DbErrorPanel message={formatDbError(error)} />;
  }

  return (
    <SettingsChrome application={app}>
      <ApplicationAccessPanel
        applicationId={app.id}
        owner={people.owner}
        members={people.members}
        orgRoles={people.orgRoles}
        isSuperadmin={!!user?.is_superadmin}
      />
    </SettingsChrome>
  );
}
