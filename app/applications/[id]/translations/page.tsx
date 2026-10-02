import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import {
  listNamespaces,
  listTranslationKeys,
} from "@/lib/actions/product";
import { AppSubnav } from "@/components/app-subnav";
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

      <Card className="mb-4 p-4">
        <form className="grid gap-3 md:grid-cols-5">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search keys…"
            className="h-9 rounded-md border border-[var(--hub-border)] px-3 text-sm md:col-span-2"
          />
          <select
            name="namespaceId"
            defaultValue={namespaceId}
            className="h-9 rounded-md border border-[var(--hub-border)] px-3 text-sm"
          >
            <option value="">All namespaces</option>
            {namespaces.map((ns) => (
              <option key={ns.id} value={ns.id}>
                {ns.name}
              </option>
            ))}
          </select>
          <select
            name="language"
            defaultValue={language}
            className="h-9 rounded-md border border-[var(--hub-border)] px-3 text-sm"
          >
            <option value="">All languages</option>
            {languages.map((l) => (
              <option key={l.id} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border border-[var(--hub-border)] px-3 text-sm"
          >
            <option value="">All statuses</option>
            <option value="MISSING">MISSING</option>
            <option value="SYSTEM_GENERATED">SYSTEM_GENERATED</option>
            <option value="MANUALLY_MODIFIED">MANUALLY_MODIFIED</option>
            <option value="APPROVED">APPROVED</option>
          </select>
          <button
            type="submit"
            className="h-9 rounded-md bg-[var(--hub-accent)] px-3 text-sm font-medium text-white md:col-span-5 md:w-fit"
          >
            Apply filters
          </button>
        </form>
      </Card>

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
