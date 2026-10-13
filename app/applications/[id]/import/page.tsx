import { notFound, redirect } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import { AppSubnav } from "@/components/app-subnav";
import { ImportWizard } from "@/components/import-wizard";
import { PageHeader } from "@/components/ui";

export default async function ApplicationImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app) notFound();
  // Catalogs import from their own list page, which knows their fields.
  if (app.model_type === "CATALOG") redirect(`/applications/${app.id}/items/import`);
  const languages = await listLanguages();

  return (
    <div>
      <PageHeader
        title={`${app.name} · Import`}
      />
      <AppSubnav application={app} />
      <ImportWizard
        applications={[app]}
        languages={languages}
        fixedApplicationId={app.id}
        lockedType={app.model_type}
      />
    </div>
  );
}
