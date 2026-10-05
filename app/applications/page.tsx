import Link from "next/link";
import { listApplications } from "@/lib/actions/applications";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  statusTone,
} from "@/components/ui";

export default async function ApplicationsPage() {
  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  let dbError = "";

  try {
    apps = await listApplications({ includeInactive: true });
  } catch (e) {
    dbError = formatDbError(e);
  }

  if (dbError) {
    return (
      <div>
        <PageHeader title="Applications" />
        <DbErrorPanel message={dbError} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Applications"
        description="Top-level apps that own string or content translations."
        actions={<LinkButton href="/applications/new">New Application</LinkButton>}
      />
      {apps.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Create Product or Press to get started."
          action={<LinkButton href="/applications/new">Create application</LinkButton>}
        />
      ) : (
        <div className="space-y-2">
          {apps.map((app) => (
            <Card
              key={app.id}
              interactive
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
            >
              <div>
                <Link
                  href={`/applications/${app.id}`}
                  className="font-semibold text-slate-900 no-underline hover:text-[var(--hub-accent)]"
                >
                  {app.name}
                </Link>
                <p className="text-sm text-slate-600">
                  {app.description || "No description"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(app.status)}>{app.status}</Badge>
                <Badge tone="info">
                  {app.model_type === "STRING" ? "Strings" : "Content"}
                </Badge>
                <Badge tone="neutral">
                  {app.access.is_owner
                    ? "Owner"
                    : app.access.can_manage
                      ? "Superadmin"
                      : "Invited"}
                </Badge>
                {app.access.can_manage ? (
                  <Link
                    href={`/applications/${app.id}/edit`}
                    className="hub-accent-link text-sm font-semibold"
                  >
                    Edit
                  </Link>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
