import { AppSubnav } from "@/components/app-subnav";
import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/ui";
import type { Application } from "@/lib/types";

export function SettingsChrome({
  application,
  children,
}: {
  application: Pick<Application, "id" | "model_type">;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Article types, publish vendors, and the checks used when a translation is reviewed."
      />
      <AppSubnav application={application} />
      <SettingsTabs applicationId={application.id} />
      {children}
    </div>
  );
}
