import { notFound } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import { getTranslationKey } from "@/lib/actions/product";
import { AppSubnav } from "@/components/app-subnav";
import { StringKeyEditor } from "@/components/string-key-editor";
import { PageHeader } from "@/components/ui";

export default async function TranslationKeyDetailPage({
  params,
}: {
  params: Promise<{ id: string; keyId: string }>;
}) {
  const { id, keyId } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "STRING") notFound();
  const key = await getTranslationKey(keyId);
  if (!key || key.application_id !== app.id) notFound();
  const languages = await listLanguages();
  const actor = await getActor();

  return (
    <div>
      <PageHeader
        title={key.key}
        description={`Namespace: ${key.namespace?.name ?? "—"} · Source: ${key.source_language}`}
        back={{
          href: `/applications/${id}/translations`,
          label: "Back to translations",
        }}
      />
      <AppSubnav application={app} />
      <StringKeyEditor
        applicationId={app.id}
        translationKey={key}
        languages={languages}
        actor={actor}
      />
    </div>
  );
}
