import { AppSubnav } from "@/components/app-subnav";
import { CollapsibleSection } from "@/components/collapsible-section";
import { SettingsTabs } from "@/components/settings-tabs";
import { PageHeader } from "@/components/ui";
import { isProduction } from "@/lib/env";
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
  const publishing = !isProduction();
  return (
    <div>
      <PageHeader
        title={withoutTabs ? "Access" : "Settings"}
        description={
          withoutTabs
            ? "Who can open this application, and what each role can do."
            : publishing
              ? "Article types, review emails, people, roles, business units, translation checks and publish connections."
              : "Article types, review emails, people, roles, business units and translation checks."
        }
      />
      <AppSubnav application={application} />
      {withoutTabs ? (
        children
      ) : (
        // minmax(0, …) columns keep a wide child (the pill row, a table) from widening the page.
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
          <SettingsTabs
            applicationId={application.id}
            canManage={application.access.can_manage}
            canManageRoles={application.access.permissions.includes("roles.manage")}
            publishing={publishing}
          />
          <div className="min-w-0">{children}</div>
        </div>
      )}
    </div>
  );
}

/** One block on a settings tab. Folds to its title and a short summary line. */
export function SettingsSection({
  id,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  /** Shown beside the title while folded. Keep it to a few words. */
  description?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <CollapsibleSection id={id} title={title} summary={description} defaultOpen={defaultOpen}>
      {children}
    </CollapsibleSection>
  );
}
