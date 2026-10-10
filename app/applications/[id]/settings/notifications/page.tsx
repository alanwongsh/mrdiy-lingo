import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { mailConfigured } from "@/lib/mail";
import { NotificationSettings } from "@/components/notification-settings";
import { SettingsChrome } from "@/components/settings-chrome";

export default async function SettingsNotificationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();

  return (
    <SettingsChrome application={app}>
      <NotificationSettings
        applicationId={app.id}
        reviewEmail={app.notify_review_email !== false}
        canConfigure={app.access.can_approve || app.access.can_manage}
        mailReady={mailConfigured()}
      />
    </SettingsChrome>
  );
}
