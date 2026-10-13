import { AccessRolesManager } from "@/components/access-roles-manager";
import { OrgRoleMap } from "@/components/org-role-map";
import { listAccessRoles } from "@/lib/actions/access-roles";
import { listOrgRoleMappings } from "@/lib/actions/org-roles";
import { getCurrentUser } from "@/lib/auth/access";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { PageHeader } from "@/components/ui";

const TITLE = "Default roles";

export default async function DefaultRolesPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.is_superadmin) {
    return (
      <div>
        <PageHeader
          title={TITLE}
          description="Maintaining default roles is limited to a Lingo superadmin."
        />
      </div>
    );
  }

  let access: Awaited<ReturnType<typeof listAccessRoles>> = null;
  let dbError = "";
  try {
    access = await listAccessRoles({ applicationId: null });
  } catch (error) {
    dbError = formatDbError(error);
  }

  if (dbError) {
    return (
      <div>
        <PageHeader title={TITLE} />
        <DbErrorPanel message={dbError} />
      </div>
    );
  }

  if (!access) {
    // Before the role migrations, job title groups still decide who can approve.
    let titles: Awaited<ReturnType<typeof listOrgRoleMappings>> = [];
    try {
      titles = await listOrgRoleMappings();
    } catch (error) {
      return (
        <div>
          <PageHeader title={TITLE} />
          <DbErrorPanel message={formatDbError(error)} />
        </div>
      );
    }
    return (
      <div>
        <PageHeader
          title={TITLE}
          description="Run migrations 025, 026, and 027 to set up roles such as Translator and Reviewer with their own permissions. Until then, job title groups decide who can approve."
        />
        <OrgRoleMap roles={titles} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={TITLE}
        description="A template. Every new application starts with a copy of these roles, then manages its own under Settings → Roles. Changes here do not affect existing applications."
      />
      <AccessRolesManager
        applicationId={null}
        roles={access.roles}
        memberCounts={access.memberCounts}
      />
    </div>
  );
}
