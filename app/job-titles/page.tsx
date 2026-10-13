import { JobTitleList } from "@/components/job-title-list";
import { listOrgRoleMappings } from "@/lib/actions/org-roles";
import { getCurrentUser } from "@/lib/auth/access";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { PageHeader } from "@/components/ui";

export default async function JobTitlesPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.is_superadmin) {
    return (
      <div>
        <PageHeader
          title="Job titles"
          description="Maintaining job titles is limited to a Lingo superadmin."
        />
      </div>
    );
  }

  let titles: Awaited<ReturnType<typeof listOrgRoleMappings>> = [];
  try {
    titles = await listOrgRoleMappings();
  } catch (error) {
    return (
      <div>
        <PageHeader title="Job titles" />
        <DbErrorPanel message={formatDbError(error)} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Job titles"
        description="Titles shown next to each person, such as Executive. Joget adds new ones when people sign in. They do not change what anyone can do."
      />
      <JobTitleList titles={titles} />
    </div>
  );
}
