import { AppSubnav } from "@/components/app-subnav";
import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/ui";
import type { AppAccess, Application } from "@/lib/types";

export function SettingsChrome({
  application,
  children,
}: {
  application: Pick<Application, "id" | "model_type"> & { access: Pick<AppAccess, "can_manage"> };
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Article types, review emails, people, translation checks and publish connections."
      />
      <AppSubnav application={application} />
      <SettingsTabs
        applicationId={application.id}
        canManage={application.access.can_manage}
      />
      {children}
    </div>
  );
}

/** Heading and short help line for one block on a settings tab. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-[var(--hub-muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
