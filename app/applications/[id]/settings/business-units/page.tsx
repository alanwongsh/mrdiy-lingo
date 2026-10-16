import { notFound, redirect } from "next/navigation";
import { listBusinessUnitsForSettings } from "@/lib/actions/business-units";
import { getApplication } from "@/lib/actions/applications";
import { can } from "@/lib/auth/permissions";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { BusinessUnitsManager } from "@/components/business-units-manager";
import { SettingsChrome } from "@/components/settings-chrome";
import { Card } from "@/components/ui";

export default async function SettingsBusinessUnitsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();
  if (!can(app.access, "roles.manage")) redirect(`/applications/${app.id}`);

  let data: Awaited<ReturnType<typeof listBusinessUnitsForSettings>> = null;
  try {
    data = await listBusinessUnitsForSettings(app.id);
  } catch (error) {
    return <DbErrorPanel message={formatDbError(error)} />;
  }

  return (
    <SettingsChrome application={app}>
      {data ? (
        <BusinessUnitsManager
          applicationId={app.id}
          units={data.units}
          memberCounts={data.memberCounts}
          actorMarkets={app.access.markets}
        />
      ) : (
        <Card className="p-5 text-sm text-amber-800">
          Run migration 032 from Setup to limit people to the countries of their business unit.
        </Card>
      )}
    </SettingsChrome>
  );
}
