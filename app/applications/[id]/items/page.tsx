import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { countItemsByStatus, listItems } from "@/lib/actions/catalog";
import { ITEM_STATUS_LABEL, itemLabel, itemLabelPlural } from "@/lib/catalog";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { CatalogItemFilters } from "@/components/catalog-item-filters";
import { CatalogItemList } from "@/components/catalog-item-list";
import { LinkButton, PageHeader, Pagination, StatCard } from "@/components/ui";
import { PAGE_SIZE, type ItemStatus } from "@/lib/types";

const STATUSES = Object.keys(ITEM_STATUS_LABEL) as ItemStatus[];

export default async function CatalogItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CATALOG") notFound();

  const label = itemLabel(app);
  const plural = itemLabelPlural(app);
  const page = Number(sp.page ?? "1") || 1;
  const q = sp.q ?? "";
  const status = STATUSES.includes(sp.status as ItemStatus) ? (sp.status as ItemStatus) : "";

  let result: Awaited<ReturnType<typeof listItems>>;
  let counts: Awaited<ReturnType<typeof countItemsByStatus>>;
  try {
    [result, counts] = await Promise.all([
      listItems({ applicationId: app.id, page, pageSize: PAGE_SIZE, search: q, status }),
      countItemsByStatus(app.id),
    ]);
  } catch (error) {
    return <DbErrorPanel message={formatDbError(error)} />;
  }

  return (
    <div>
      <PageHeader
        title={app.name}
        description={
          app.description ||
          `Each ${label} keeps its fields in every language. Approved translations are reused across ${plural}.`
        }
        actions={
          app.access.can_edit ? (
            <LinkButton href={`/applications/${app.id}/items/new`}>New {label}</LinkButton>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Draft" value={counts.DRAFT} />
        <StatCard label="In review" value={counts.REVIEW} tone="info" />
        <StatCard label="Changes requested" value={counts.CHANGES_REQUESTED} tone="warn" />
        <StatCard label="Approved" value={counts.APPROVED} tone="good" />
      </div>

      <CatalogItemFilters applicationId={app.id} itemLabel={label} initial={{ q, status }} />

      <CatalogItemList
        applicationId={app.id}
        items={result.items}
        itemLabel={label}
        canEdit={app.access.can_edit}
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath={`/applications/${app.id}/items`}
        query={{ q, status }}
      />
    </div>
  );
}
