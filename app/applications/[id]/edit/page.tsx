import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { getCurrentUser } from "@/lib/auth/access";
import { PageHeader } from "@/components/ui";
import { ApplicationDetailsForm } from "@/components/application-details-form";

export default async function EditApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [app, user] = await Promise.all([getApplication(id), getCurrentUser()]);
  if (!app) notFound();

  if (!user?.is_superadmin) {
    return (
      <div className="text-sm text-red-700">
        Only a Lingo superadmin can change this application&apos;s details.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Edit ${app.name}`}
        back={{ href: `/applications/${id}`, label: "Back to application" }}
      />
      <ApplicationDetailsForm application={app} showModelType savedHref={`/applications/${id}`} />
    </div>
  );
}
