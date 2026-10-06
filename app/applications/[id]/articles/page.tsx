import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listContentTypes } from "@/lib/actions/content-types";
import { listLanguages } from "@/lib/actions/languages";
import { listArticles } from "@/lib/actions/press";
import { AppSubnav } from "@/components/app-subnav";
import { ArticleListFilters } from "@/components/article-list-filters";
import { ArticleListTable } from "@/components/article-list-table";
import { LinkButton, PageHeader, Pagination } from "@/components/ui";
import { PAGE_SIZE } from "@/lib/types";

function parseSourceLocales(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean)
    ),
  ];
}

export default async function ArticlesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();

  const page = Number(sp.page ?? "1") || 1;
  const q = sp.q ?? "";
  const status = sp.status ?? "";
  const contentType = sp.type ?? "";
  const sourceLocales = parseSourceLocales(sp.source);
  const due = sp.due ?? "";
  const market = sp.market ?? "";

  const [result, languages, contentTypes] = await Promise.all([
    listArticles({
      applicationId: app.id,
      page,
      pageSize: PAGE_SIZE,
      search: q || undefined,
      status: (status as never) || undefined,
      contentType: contentType || undefined,
      sourceLanguages: sourceLocales,
      market: market || undefined,
      due: (due as never) || undefined,
    }),
    listLanguages(),
    listContentTypes(app.id, { includeInactive: true }),
  ]);
  const typeNames = Object.fromEntries(
    contentTypes.map((type) => [type.code, type.name])
  );

  const sourceParam = sourceLocales.join(",");

  return (
    <div>
      <PageHeader
        title="Articles"
        description={`${result.total} article${result.total === 1 ? "" : "s"}`}
        actions={
          <LinkButton href={`/applications/${app.id}/articles/new`}>
            New article
          </LinkButton>
        }
      />
      <AppSubnav application={app} />

      <ArticleListFilters
        applicationId={app.id}
        languages={languages}
        contentTypes={contentTypes}
        canEdit={app.access.can_edit}
        initial={{
          q,
          source: sourceLocales,
          status,
          type: contentType,
          market,
          due,
        }}
      />

      <ArticleListTable
        applicationId={app.id}
        articles={result.items}
        languages={languages}
        typeNames={typeNames}
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath={`/applications/${app.id}/articles`}
        query={{
          q,
          source: sourceParam || undefined,
          status,
          type: contentType,
          market,
          due,
        }}
      />
    </div>
  );
}
