import { listApplications } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import { ImportWizard } from "@/components/import-wizard";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { PageHeader } from "@/components/ui";

export default async function ImportPage() {
  let applications: Awaited<ReturnType<typeof listApplications>> = [];
  let languages: Awaited<ReturnType<typeof listLanguages>> = [];
  let dbError = "";

  try {
    applications = await listApplications({
      includeInactive: true,
      editableOnly: true,
    });
    languages = await listLanguages();
  } catch (e) {
    dbError = formatDbError(e);
  }

  return (
    <div>
      <PageHeader
        title="Import"
        description="Upload Excel or CSV. Chosen languages are translated as part of the import."
      />
      {dbError ? (
        <DbErrorPanel message={dbError} />
      ) : applications.length === 0 ? (
        <p className="text-sm text-[var(--hub-muted)]">
          Create an application first.
        </p>
      ) : (
        <ImportWizard applications={applications} languages={languages} />
      )}
    </div>
  );
}
