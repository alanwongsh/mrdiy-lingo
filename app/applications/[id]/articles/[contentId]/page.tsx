import { notFound } from "next/navigation";
import { getActor } from "@/lib/auth/actor";
import { getApplication } from "@/lib/actions/applications";
import { listContentTypes } from "@/lib/actions/content-types";
import { listArticleComments } from "@/lib/actions/comments";
import { listLanguages } from "@/lib/actions/languages";
import { getArticle } from "@/lib/actions/press";
import { AppSubnav } from "@/components/app-subnav";
import { ArticleComments } from "@/components/article-comments";
import { ArticleView } from "@/components/article-view";
import { LinkButton, PageHeader } from "@/components/ui";
import type { ArticleComment } from "@/lib/types";

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string; contentId: string }>;
}) {
  const { id, contentId } = await params;
  const app = await getApplication(id);
  if (!app || app.model_type !== "CONTENT") notFound();
  const article = await getArticle(contentId);
  if (!article || article.application_id !== app.id) notFound();
  const [languages, contentTypes] = await Promise.all([
    listLanguages(),
    listContentTypes(app.id, { includeInactive: true }),
  ]);
  const contentTypeName =
    contentTypes.find((type) => type.code === article.content_type)?.name ??
    article.content_type;
  const actor = await getActor();
  let comments: ArticleComment[] = [];
  let commentsError = "";
  try {
    comments = await listArticleComments(contentId);
  } catch (error) {
    commentsError = error instanceof Error ? error.message : "Comments unavailable";
  }
  const articleCodes = new Set(
    [article.source_language, ...(article.target_languages ?? [])]
      .filter(Boolean)
      .map((code) => code.trim().toLowerCase())
  );
  const commentLanguages = languages.filter((language) =>
    articleCodes.has(language.code.trim().toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title={article.title}
        back={{
          href: `/applications/${id}/articles`,
          label: "Back to articles",
        }}
        actions={
          <LinkButton
            href={`/applications/${id}/articles/${contentId}/edit`}
            variant="secondary"
          >
            Edit
          </LinkButton>
        }
      />
      <AppSubnav application={app} />
      <ArticleView
        key={article.id}
        article={article}
        languages={languages}
        contentTypeName={contentTypeName}
      />
      <ArticleComments
        applicationId={app.id}
        contentId={article.id}
        comments={comments}
        languages={commentLanguages.length > 0 ? commentLanguages : languages}
        activeLanguage={article.source_language}
        actor={actor}
        loadError={commentsError}
      />
    </div>
  );
}
