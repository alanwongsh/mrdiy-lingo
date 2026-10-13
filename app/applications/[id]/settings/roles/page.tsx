import { notFound, redirect } from "next/navigation";
import { listAccessRoles } from "@/lib/actions/access-roles";
import { getApplication } from "@/lib/actions/applications";
import { can } from "@/lib/auth/permissions";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { AccessRolesManager } from "@/components/access-roles-manager";
import { SettingsChrome } from "@/components/settings-chrome";
import { Card } from "@/components/ui";

export default async function SettingsRolesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app) notFound();
  if (!can(app.access, "roles.manage")) redirect(`/applications/${app.id}`);

  let access: Awaited<ReturnType<typeof listAccessRoles>> = null;
  try {
    access = await listAccessRoles({ applicationId: app.id });
  } catch (error) {
    return <DbErrorPanel message={formatDbError(error)} />;
  }

  return (
    <SettingsChrome application={app}>
      {access ? (
        <AccessRolesManager
          applicationId={app.id}
          modelType={app.model_type}
          roles={access.roles}
          memberCounts={access.memberCounts}
          actorPermissions={app.access.permissions}
        />
      ) : (
        <Card className="p-5 text-sm text-amber-800">
          Run migrations 025, 026, and 027 from Setup to give this application its own roles.
        </Card>
      )}
    </SettingsChrome>
  );
}
