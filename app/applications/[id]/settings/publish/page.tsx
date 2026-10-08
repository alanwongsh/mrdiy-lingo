import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listPublishIntegrationTypes, listPublishVendors } from "@/lib/actions/publish";
import { PublishVendorsManager } from "@/components/publish-vendors-manager";
import { SettingsChrome } from "@/components/settings-chrome";
import type { PublishIntegrationType } from "@/lib/publish/integrations/integration";
import type { PublishVendor } from "@/lib/types";

export default async function SettingsPublishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();

  let vendors: PublishVendor[] = [];
  let types: PublishIntegrationType[] = [];
  let loadError = "";
  try {
    [vendors, types] = await Promise.all([
      listPublishVendors(app.id),
      listPublishIntegrationTypes(),
    ]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Publish settings are unavailable.";
    try {
      types = await listPublishIntegrationTypes();
    } catch {
      types = [];
    }
  }

  return (
    <SettingsChrome application={app}>
      {loadError ? <p className="mb-4 text-sm text-red-700">{loadError}</p> : null}
      <PublishVendorsManager
        applicationId={app.id}
        vendors={vendors}
        types={types}
        canConfigure={app.access.can_approve || app.access.can_manage}
        disabled={Boolean(loadError)}
      />
    </SettingsChrome>
  );
}
