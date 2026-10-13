import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listItemFields } from "@/lib/actions/catalog";
import { listLanguages } from "@/lib/actions/languages";
import { itemLabel } from "@/lib/catalog";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { CatalogNewItem } from "@/components/catalog-new-item";
import { PageHeader } from "@/components/ui";

export default async function NewCatalogItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CATALOG" || !app.access.can_edit) notFound();
  const label = itemLabel(app);

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
        title={`New ${label}`}
        description="Saved as a draft. Submit it for review when the source text is ready."
        back={{ href: `/applications/${app.id}/items`, label: `Back to ${app.name}` }}
      />
      <CatalogNewItem applicationId={app.id} itemLabel={label} fields={fields} languages={languages} />
    </div>
  );
}
