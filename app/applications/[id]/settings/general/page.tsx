import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import {
  listContentTypeCounts,
  listContentTypes,
} from "@/lib/actions/content-types";
import { listLanguages } from "@/lib/actions/languages";
import { listTones } from "@/lib/actions/tones";
import { mailConfigured } from "@/lib/mail";
import { ContentTypesManager } from "@/components/content-types-manager";
import { NotificationSettings } from "@/components/notification-settings";
import { TonesManager } from "@/components/tones-manager";
import { SettingsChrome, SettingsSection } from "@/components/settings-chrome";

export default async function SettingsGeneralPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();
  const [contentTypes, counts, tones, languages] = await Promise.all([
    listContentTypes(app.id, { includeInactive: true }),
    listContentTypeCounts(app.id),
    listTones(app.id, { includeInactive: true }),
    listLanguages(),
  ]);
  const canEditTypes = can(app.access, "settings.content_types");
  const reviewEmail = app.notify_review_email !== false;

  return (
    <SettingsChrome
      application={app}
      title="General"
      description="Article types, writing tones, and review emails."
    >
      <div className="space-y-3">
        <SettingsSection
          id="types"
          title="Article types"
          description={`${contentTypes.length} ${contentTypes.length === 1 ? "type" : "types"}`}
        >
          <p className="mb-3 text-sm text-[var(--hub-muted)]">
            Labels for this app’s articles. New articles start as General. Import creates a type
            when the file uses one that is not here yet.
          </p>
          <ContentTypesManager
            applicationId={app.id}
            contentTypes={contentTypes}
            counts={counts}
            tones={tones}
            canEdit={canEditTypes}
          />
        </SettingsSection>

        <SettingsSection
          id="tones"
          title="Writing tones"
          description={`${tones.length} ${tones.length === 1 ? "tone" : "tones"}`}
        >
          <p className="mb-3 text-sm text-[var(--hub-muted)]">
            How machine translation should read, such as Formal, Press, or Social media. Give an
            article type a default tone, or pick one on an article. Tones that allow rewording
            are marked Adapted for reviewers.
          </p>
          <TonesManager
            applicationId={app.id}
            tones={tones}
            languages={languages}
            canEdit={canEditTypes}
          />
        </SettingsSection>

        <SettingsSection
          id="notifications"
          title="Review emails"
          description={reviewEmail ? "On" : "Off"}
        >
          <NotificationSettings
            applicationId={app.id}
            reviewEmail={reviewEmail}
            canConfigure={can(app.access, "settings.notifications")}
            mailReady={mailConfigured()}
          />
        </SettingsSection>
      </div>
    </SettingsChrome>
  );
}
