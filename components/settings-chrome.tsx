import { CollapsibleSection } from "@/components/collapsible-section";
import { PageHeader } from "@/components/ui";
import type { AppAccess, Application } from "@/lib/types";

/**
 * Header for an application's settings pages. Moving between them is the sidebar's job,
 * so each page only names itself.
 */
export function SettingsChrome({
  title,
  description,
  children,
}: {
  application?: Pick<Application, "id" | "model_type" | "item_label"> & {
    access: Pick<AppAccess, "can_manage" | "permissions">;
  };
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      {children}
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
