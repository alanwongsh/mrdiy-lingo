import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listItemFields, listItemFieldUsage } from "@/lib/actions/catalog";
import { itemLabel } from "@/lib/catalog";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { CatalogFieldsManager } from "@/components/catalog-fields-manager";
import { PageHeader } from "@/components/ui";

export default async function CatalogFieldsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CATALOG") notFound();

  let fields: Awaited<ReturnType<typeof listItemFields>>;
  let usage: Awaited<ReturnType<typeof listItemFieldUsage>>;
  try {
    [fields, usage] = await Promise.all([
      listItemFields(app.id, { includeInactive: true }),
      listItemFieldUsage(app.id),
    ]);
  } catch (error) {
    return <DbErrorPanel message={formatDbError(error)} />;
  }

  return (
    <div>
      <PageHeader
        title="Fields"
        description={`Field names offered when adding fields to a ${itemLabel(app)}. Anyone who edits can add a new one from the ${itemLabel(app)} itself. Fields in use can be switched off but not deleted. Roles with the Catalog fields permission can change them.`}
      />
      <CatalogFieldsManager
        applicationId={app.id}
        fields={fields}
        usage={usage}
        canManage={can(app.access, "settings.fields")}
      />
    </div>
  );
}
