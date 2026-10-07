import { notFound, redirect } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import {
  listQualitySettings,
  listTerminologyEntries,
} from "@/lib/actions/quality";
import { QualitySettings } from "@/components/quality-settings";
import { SettingsChrome } from "@/components/settings-chrome";
import { PAGE_SIZE } from "@/lib/types";

export default async function SettingsQualityPage({
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

  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const q = sp.q ?? "";
  const source = sp.source ?? "";
  const target = sp.target ?? "";
  const status = sp.status ?? "";

  let categories: Awaited<ReturnType<typeof listQualitySettings>>["categories"] = [];
  let terms: Awaited<ReturnType<typeof listTerminologyEntries>> | null = null;
  let languages: Awaited<ReturnType<typeof listLanguages>> = [];
  let loadError = "";
  try {
    const [settings, terminology, languageRows] = await Promise.all([
      listQualitySettings(app.id),
      listTerminologyEntries({
        applicationId: app.id,
        page,
        pageSize: PAGE_SIZE,
        search: q,
        sourceLanguage: source,
        targetLanguage: target,
        status,
      }),
      listLanguages(),
    ]);
    categories = settings.categories;
    terms = terminology;
    languages = languageRows;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Quality settings are unavailable.";
  }

  if (terms && terms.total > 0) {
    const totalPages = Math.ceil(terms.total / terms.pageSize);
    if (page > totalPages) {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (source) params.set("source", source);
      if (target) params.set("target", target);
      if (status) params.set("status", status);
      params.set("page", String(totalPages));
      redirect(`/applications/${app.id}/settings/quality?${params.toString()}`);
    }
  }

  return (
    <SettingsChrome application={app}>
      {terms ? (
        <QualitySettings
          applicationId={app.id}
          categories={categories}
          terminology={terms.items}
          languages={languages}
          canManage={app.access.can_manage}
          page={terms.page}
          pageSize={terms.pageSize}
          total={terms.total}
          filters={{ q, source, target, status }}
        />
      ) : (
        <p className="text-sm text-red-700">{loadError}</p>
      )}
    </SettingsChrome>
  );
}
