import { AppSubnav } from "@/components/app-subnav";
import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/ui";
import type { AppAccess, Application } from "@/lib/types";

export function SettingsChrome({
  application,
  children,
}: {
  application: Pick<Application, "id" | "model_type" | "item_label"> & {
    access: Pick<AppAccess, "can_manage" | "permissions">;
  };
  children: React.ReactNode;
}) {
  // Only CONTENT has settings tabs. Catalog and string apps reach People and Roles from their own tabs.
  const withoutTabs = application.model_type !== "CONTENT";
  return (
    <div>
      <PageHeader
        title={withoutTabs ? "Access" : "Settings"}
        description={
          withoutTabs
            ? "Who can open this application, and what each role can do."
            : "Article types, review emails, people, roles, translation checks and publish connections."
        }
      />
      <AppSubnav application={application} />
      {withoutTabs ? null : (
        <SettingsTabs
          applicationId={application.id}
          canManage={application.access.can_manage}
          canManageRoles={application.access.permissions.includes("roles.manage")}
        />
      )}
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
