import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import {
  listContentTypeCounts,
  listContentTypes,
} from "@/lib/actions/content-types";
import { AppSubnav } from "@/components/app-subnav";
import { ContentTypesManager } from "@/components/content-types-manager";
import { PageHeader } from "@/components/ui";

export default async function ContentTypesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();
  const [contentTypes, counts] = await Promise.all([
    listContentTypes(app.id, { includeInactive: true }),
    listContentTypeCounts(app.id),
  ]);

  return (
    <div>
      <PageHeader
        title="Types"
        description="Labels for this app’s articles. New articles start as General. Import creates a type when the file uses one that is not here yet."
      />
      <AppSubnav application={app} />
      <ContentTypesManager
        applicationId={app.id}
        contentTypes={contentTypes}
        counts={counts}
        canEdit={app.access.can_edit}
      />
    </div>
  );
}
