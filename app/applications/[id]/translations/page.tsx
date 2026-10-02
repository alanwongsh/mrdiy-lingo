import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import {
  listNamespaces,
  listTranslationKeys,
} from "@/lib/actions/product";
import { AppSubnav } from "@/components/app-subnav";
import { TranslationListFilters } from "@/components/translation-list-filters";
import {
  Badge,
  Card,
  LinkButton,
  PageHeader,
  Pagination,
  statusTone,
} from "@/components/ui";
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

  const displayLangs = languages
    .filter((l) => ["en", "ms", "th", "id"].includes(l.code))
    .slice(0, 4);

  return (
    <div>
      <PageHeader
        title={`${app.name} · Translations`}
        description="Server-side search, filters, and pagination — never load the full key set."
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

      <Card className="overflow-hidden">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Namespace</th>
              {displayLangs.map((l) => (
                <th key={l.code} className="px-4 py-3">
                  {l.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => (
              <tr
                key={item.id}
                className="border-b border-[var(--hub-border)] align-top"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/applications/${app.id}/translations/${item.id}`}
                    className="font-mono text-xs text-[var(--hub-accent)] hover:underline"
                  >
                    {item.key}
                  </Link>
                  <div className="mt-1 max-w-xs truncate text-xs text-[var(--hub-muted)]">
                    {item.source_text}
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--hub-muted)]">
                  {item.namespace?.name ?? "—"}
                </td>
                {displayLangs.map((l) => {
                  const t = item.translations?.find(
                    (tr) => tr.language_code === l.code
                  );
                  return (
                    <td key={l.code} className="px-4 py-3">
                      <div className="max-w-[10rem] truncate">
                        {t?.current_text || "—"}
                      </div>
                      {t ? (
                        <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                      ) : (
                        <Badge>MISSING</Badge>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {result.items.length === 0 ? (
              <tr>
                <td
                  colSpan={2 + displayLangs.length}
                  className="px-4 py-8 text-center text-[var(--hub-muted)]"
                >
                  No translation keys found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

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
