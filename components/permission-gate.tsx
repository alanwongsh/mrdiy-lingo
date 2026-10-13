import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { can, type PermissionKey } from "@/lib/auth/permissions";
import { EmptyState } from "@/components/ui";

/**
 * Server guard for a page whose own code runs in the browser. Shows a short
 * notice instead of the page when the person's role lacks the permission.
 */
export async function PermissionGate({
  applicationId,
  permission,
  message,
  children,
}: {
  applicationId: string;
  permission: PermissionKey;
  message: string;
  children: React.ReactNode;
}) {
  const app = await getApplication(applicationId);
  if (!app) notFound();
  if (!can(app.access, permission)) {
    return <EmptyState title="Not available for your role" description={message} />;
  }
  return children;
}
