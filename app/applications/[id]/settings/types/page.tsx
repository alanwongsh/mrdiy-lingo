import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import {
  listContentTypeCounts,
  listContentTypes,
} from "@/lib/actions/content-types";
import { ContentTypesManager } from "@/components/content-types-manager";
import { SettingsChrome } from "@/components/settings-chrome";

export default async function SettingsTypesPage({
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
    <SettingsChrome application={app}>
      <p className="mb-4 text-sm text-slate-500">
        Labels for this app’s articles. New articles start as General. Import creates a type when the file uses one that is not here yet.
      </p>
      <ContentTypesManager
        applicationId={app.id}
        contentTypes={contentTypes}
        counts={counts}
        canEdit={app.access.can_edit}
      />
    </SettingsChrome>
  );
}
