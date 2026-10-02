import { LanguagesManager } from "@/components/languages-manager";
import { listLanguages } from "@/lib/actions/languages";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { PageHeader } from "@/components/ui";

export default async function LanguagesPage() {
  let languages: Awaited<ReturnType<typeof listLanguages>> = [];
  let dbError = "";

  try {
    languages = await listLanguages({ includeInactive: true });
  } catch (e) {
    dbError = formatDbError(e);
  }

  return (
    <div>
      <PageHeader
        title="Languages"
        description="Manage languages available for Product and Press translations."
      />
      {dbError ? (
        <DbErrorPanel message={dbError} />
      ) : (
        <LanguagesManager initialLanguages={languages} />
      )}
    </div>
  );
}
