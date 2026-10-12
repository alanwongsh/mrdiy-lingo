import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import {
  listContentTypeCounts,
  listContentTypes,
} from "@/lib/actions/content-types";
import { mailConfigured } from "@/lib/mail";
import { ContentTypesManager } from "@/components/content-types-manager";
import { NotificationSettings } from "@/components/notification-settings";
import { SettingsChrome, SettingsSection } from "@/components/settings-chrome";

export default async function SettingsGeneralPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();
  const [contentTypes, counts] = await Promise.all([
    listContentTypes(app.id, { includeInactive: true }),
    listContentTypeCounts(app.id),
  ]);

  return (
    <SettingsChrome application={app}>
      <div className="space-y-10">
        <SettingsSection
          id="types"
          title="Article types"
          description="Labels for this app’s articles. New articles start as General. Import creates a type when the file uses one that is not here yet."
        >
          <ContentTypesManager
            applicationId={app.id}
            contentTypes={contentTypes}
            counts={counts}
            canEdit={app.access.can_edit}
          />
        </SettingsSection>

        <SettingsSection id="notifications" title="Review emails">
          <NotificationSettings
            applicationId={app.id}
            reviewEmail={app.notify_review_email !== false}
            canConfigure={app.access.can_approve || app.access.can_manage}
            mailReady={mailConfigured()}
          />
        </SettingsSection>
      </div>
    </SettingsChrome>
  );
}
