import { getCurrentUser } from "@/lib/auth/access";
import { NewApplicationForm } from "@/components/new-application-form";
import { PageHeader } from "@/components/ui";

export default async function NewApplicationPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.is_superadmin) {
    return (
      <div>
        <PageHeader
          title="New application"
          description="Only a Lingo superadmin can create applications. Ask one to create it and add you."
        />
      </div>
    );
  }
  return <NewApplicationForm />;
}
