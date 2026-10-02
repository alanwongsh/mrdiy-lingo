import { notFound } from "next/navigation";
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
  const languages = await listLanguages();

  return (
    <div>
      <PageHeader
        title={`${app.name} · Import`}
        description="Validate and import without silently overwriting — unchanged rows are skipped, changes create versions. Optionally auto-translate selected languages."
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
