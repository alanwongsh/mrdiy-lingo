import { NamespacesManager } from "@/components/namespaces-manager";
import { AppSubnav } from "@/components/app-subnav";
import { PageHeader } from "@/components/ui";
import { getApplication } from "@/lib/actions/applications";
import { listNamespaces } from "@/lib/actions/product";
import { notFound } from "next/navigation";

export default async function NamespacesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "STRING") notFound();
  const namespaces = await listNamespaces(app.id, { includeInactive: true });

  return (
    <div>
      <PageHeader
        title={`${app.name} · Namespaces`}
        description="Organize translation keys for navigation. Namespaces do not affect key uniqueness."
      />
      <AppSubnav application={app} />
      <NamespacesManager applicationId={app.id} initialNamespaces={namespaces} />
    </div>
  );
}
