import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { getItemDetail } from "@/lib/actions/catalog";
import { listLanguages } from "@/lib/actions/languages";
import { itemLabel } from "@/lib/catalog";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { CatalogItemEditor } from "@/components/catalog-item-editor";
import { PageHeader } from "@/components/ui";

export default async function CatalogItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CATALOG") notFound();

  let detail: Awaited<ReturnType<typeof getItemDetail>>;
  let languages: Awaited<ReturnType<typeof listLanguages>>;
  try {
    [detail, languages] = await Promise.all([getItemDetail(itemId), listLanguages({ includeInactive: true })]);
  } catch (error) {
    return <DbErrorPanel message={formatDbError(error)} />;
  }
  if (!detail || detail.item.application_id !== app.id) notFound();
  const label = itemLabel(app);

  return (
    <div>
      <PageHeader
        title={`${label} ${detail.item.item_code}`}
        description={detail.item.name || undefined}
        back={{ href: `/applications/${app.id}/items`, label: `Back to ${app.name}` }}
      />
      <CatalogItemEditor
        applicationId={app.id}
        itemLabel={label}
        item={detail.item}
        fields={detail.fields}
        values={detail.values}
        events={detail.events}
        languages={languages}
        canEdit={app.access.can_edit}
        canApprove={app.access.can_approve}
      />
    </div>
  );
}
