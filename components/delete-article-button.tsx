"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteArticle } from "@/lib/actions/press";
import { Button } from "@/components/ui";

export function DeleteArticleButton({
  applicationId,
  contentId,
  title,
  redirectTo,
}: {
  applicationId: string;
  contentId: string;
  title: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Delete “${title}”? Translations and version history will be removed.`
          )
        ) {
          return;
        }
        startTransition(async () => {
          await deleteArticle({ contentId, applicationId });
          if (redirectTo) {
            router.push(redirectTo);
          } else {
            router.refresh();
          }
        });
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
