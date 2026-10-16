import { can } from "@/lib/auth/permissions";
import { notFound, redirect } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import {
  listQualitySettings,
  listTerminologyEntries,
} from "@/lib/actions/quality";
import { listPublishIntegrationTypes, listPublishVendors } from "@/lib/actions/publish";
import { isProduction } from "@/lib/env";
import { listBoilerplate, type BoilerplateSet } from "@/lib/actions/boilerplate";
import { BoilerplateManager } from "@/components/boilerplate-manager";
import { PublishVendorsManager } from "@/components/publish-vendors-manager";
import { QualitySettings } from "@/components/quality-settings";
import { SettingsChrome, SettingsSection } from "@/components/settings-chrome";
import type { PublishIntegrationType } from "@/lib/publish/integrations/integration";
import { PAGE_SIZE, type PublishVendor } from "@/lib/types";

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

  let boilerplate: BoilerplateSet[] = [];
  let boilerplateError = "";
  try {
    boilerplate = await listBoilerplate(app.id);
  } catch (error) {
    boilerplateError = error instanceof Error ? error.message : "Boilerplate is unavailable.";
  }

  const publishing = !isProduction();
  let vendors: PublishVendor[] = [];
  let vendorTypes: PublishIntegrationType[] = [];
  let vendorError = "";
  if (publishing) {
    try {
      [vendors, vendorTypes] = await Promise.all([
        listPublishVendors(app.id),
        listPublishIntegrationTypes(),
      ]);
    } catch (error) {
      vendorError = error instanceof Error ? error.message : "Publish settings are unavailable.";
      try {
        vendorTypes = await listPublishIntegrationTypes();
      } catch {
        vendorTypes = [];
      }
    }
  }

  return (
    <SettingsChrome application={app}>
      <div className="space-y-3">
        {terms ? (
          <QualitySettings
            applicationId={app.id}
            categories={categories}
            terminology={terms.items}
            languages={languages}
            canManage={can(app.access, "settings.quality")}
            canEditTerms={can(app.access, "settings.terminology")}
            page={terms.page}
            pageSize={terms.pageSize}
            total={terms.total}
            filters={{ q, source, target, status }}
          />
        ) : (
          <p className="text-sm text-red-700">{loadError}</p>
        )}

        <SettingsSection
          id="boilerplate"
          title="Standard text"
          description={`${boilerplate.length} ${boilerplate.length === 1 ? "passage" : "passages"}`}
        >
          <BoilerplateManager
            applicationId={app.id}
            sets={boilerplate}
            languages={languages}
            canEdit={can(app.access, "settings.boilerplate")}
            loadError={boilerplateError}
          />
        </SettingsSection>

        {publishing ? (
          <SettingsSection
            id="publishing"
            title="Publish connections"
            description={`${vendors.length} ${vendors.length === 1 ? "connection" : "connections"}`}
          >
            {vendorError ? <p className="text-sm text-red-700">{vendorError}</p> : null}
            <PublishVendorsManager
              applicationId={app.id}
              vendors={vendors}
              types={vendorTypes}
              canConfigure={can(app.access, "settings.quality")}
              disabled={Boolean(vendorError)}
            />
          </SettingsSection>
        ) : null}
      </div>
    </SettingsChrome>
  );
}
