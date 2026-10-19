import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listItemFields } from "@/lib/actions/catalog";
import { listLanguages } from "@/lib/actions/languages";
import { itemLabel, itemLabelPlural } from "@/lib/catalog";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { CatalogImport } from "@/components/catalog-import";
import { PageHeader } from "@/components/ui";

export default async function CatalogImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CATALOG") notFound();

  let fields: Awaited<ReturnType<typeof listItemFields>>;
  let languages: Awaited<ReturnType<typeof listLanguages>>;
  try {
    [fields, languages] = await Promise.all([listItemFields(app.id), listLanguages()]);
  } catch (error) {
    return <DbErrorPanel message={formatDbError(error)} />;
  }

  return (
    <div>
      <PageHeader
        title={`Import ${itemLabelPlural(app)}`}
        description="One row per record. Rows are matched on code, so the same file can be imported again to update."
      />
      {can(app.access, "content.import") ? (
        <CatalogImport applicationId={app.id} itemLabel={itemLabel(app)} fields={fields} languages={languages} />
      ) : (
        <p className="text-sm text-[var(--hub-muted)]">You can view this catalog but not import into it.</p>
      )}
    </div>
  );
}
