import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import {
  listNamespaces,
  listTranslationKeys,
} from "@/lib/actions/product";
import { AppSubnav } from "@/components/app-subnav";
import { TranslationKeyList } from "@/components/translation-key-list";
import { TranslationListFilters } from "@/components/translation-list-filters";
import { LinkButton, PageHeader, Pagination } from "@/components/ui";
import { PAGE_SIZE } from "@/lib/types";

export default async function TranslationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const app = await getApplication(id);
  if (!app || app.model_type !== "STRING") notFound();

  const page = Number(sp.page ?? "1") || 1;
  const q = sp.q ?? "";
  const namespaceId = sp.namespaceId ?? "";
  const language = sp.language ?? "";
  const status = sp.status ?? "";

  const [namespaces, languages, result] = await Promise.all([
    listNamespaces(app.id, { includeInactive: true }),
    listLanguages(),
    listTranslationKeys({
      applicationId: app.id,
      page,
      pageSize: PAGE_SIZE,
      search: q || undefined,
      namespaceId: namespaceId || undefined,
      languageCode: language || undefined,
      status: (status as never) || undefined,
    }),
  ]);

  return (
    <div>
      <PageHeader
        title={`${app.name} · Translations`}
        description="Browse keys with a scrollable language panel — pick which locales to preview."
        actions={
          <LinkButton href={`/applications/${app.id}/translations/new`}>
            New key
          </LinkButton>
        }
      />
      <AppSubnav application={app} />

      <TranslationListFilters
        applicationId={app.id}
        namespaces={namespaces}
        languages={languages}
        initial={{ q, namespaceId, language, status }}
      />

      <TranslationKeyList
        applicationId={app.id}
        languages={languages}
        items={result.items}
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath={`/applications/${app.id}/translations`}
        query={{ q, namespaceId, language, status }}
      />
    </div>
  );
}
