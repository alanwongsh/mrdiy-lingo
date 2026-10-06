import { OrgRoleMap } from "@/components/org-role-map";
import { listOrgRoleMappings } from "@/lib/actions/org-roles";
import { getCurrentUser } from "@/lib/auth/access";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { PageHeader } from "@/components/ui";

export default async function RolesPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.is_superadmin) {
    return (
      <div>
        <PageHeader
          title="Roles"
          description="Grouping account roles is limited to a Lingo superadmin."
        />
      </div>
    );
  }

  let roles: Awaited<ReturnType<typeof listOrgRoleMappings>> = [];
  let dbError = "";
  try {
    roles = await listOrgRoleMappings();
  } catch (error) {
    dbError = formatDbError(error);
  }

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Group the roles stored on each account. HOD can approve. Executive and the other titles in Edit and draft cannot."
      />
      {dbError ? <DbErrorPanel message={dbError} /> : <OrgRoleMap roles={roles} />}
    </div>
  );
}
