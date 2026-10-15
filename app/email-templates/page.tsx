import { EmailTemplateEditor } from "@/components/email-template-editor";
import { getReviewEmailTemplate } from "@/lib/actions/email-templates";
import { getCurrentUser } from "@/lib/auth/access";
import { DbErrorPanel, formatDbError } from "@/lib/db/errors";
import { mailConfigured, mailFromOverridden } from "@/lib/mail";
import { resolveReviewTemplate } from "@/lib/notifications/review-template";
import { PageHeader } from "@/components/ui";

export default async function EmailTemplatesPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.is_superadmin) {
    return (
      <div>
        <PageHeader
          title="Email templates"
          description="Email templates are limited to a Lingo superadmin."
        />
      </div>
    );
  }
  let saved: Awaited<ReturnType<typeof getReviewEmailTemplate>> = null;
  let dbError = "";

  try {
    saved = await getReviewEmailTemplate();
  } catch (e) {
    dbError = formatDbError(e);
  }

  return (
    <div>
      <PageHeader
        title="Email templates"
        description="Wording of the email approvers get when an article is ready for review. Use variables to fill in details of each article."
      />
      {dbError ? (
        <DbErrorPanel message={dbError} />
      ) : (
        <EmailTemplateEditor
          initialTemplate={resolveReviewTemplate(saved)}
          updatedAt={saved?.updated_at ?? null}
          mailReady={mailConfigured()}
          senderOverridden={mailFromOverridden()}
        />
      )}
    </div>
  );
}
