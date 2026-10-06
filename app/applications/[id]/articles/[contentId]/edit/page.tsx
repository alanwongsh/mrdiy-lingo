import { notFound } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { getApplication } from "@/lib/actions/applications";
import { listArticleComments } from "@/lib/actions/comments";
import { listLanguages } from "@/lib/actions/languages";
import { getArticle } from "@/lib/actions/press";
import { AppSubnav } from "@/components/app-subnav";
import { ArticleEditor } from "@/components/article-editor";
import { PageHeader } from "@/components/ui";
import type { ArticleComment } from "@/lib/types";

export default async function ArticleEditPage({
  params,
}: {
  params: Promise<{ id: string; contentId: string }>;
}) {
  const { id, contentId } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();
  const article = await getArticle(contentId);
  if (!article || article.application_id !== app.id) notFound();
  const languages = await listLanguages();
  const actor = await getActor();
  let comments: ArticleComment[] = [];
  let commentsError = "";
  try {
    comments = await listArticleComments(contentId);
  } catch (error) {
    commentsError = error instanceof Error ? error.message : "Comments unavailable";
  }

  return (
    <div>
      <PageHeader
        title={article.title}
        description="Edit"
        back={{
          href: `/applications/${id}/articles/${contentId}`,
          label: "Back to article",
        }}
      />
      <AppSubnav application={app} />
      <ArticleEditor
        applicationId={app.id}
        article={article}
        languages={languages}
        actor={actor}
        canApprove={app.access.can_approve}
        comments={comments}
        commentsError={commentsError}
      />
    </div>
  );
}
