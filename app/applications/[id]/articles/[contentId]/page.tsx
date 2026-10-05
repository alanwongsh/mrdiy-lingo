import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import { getArticle } from "@/lib/actions/press";
import { AppSubnav } from "@/components/app-subnav";
import { ArticleView } from "@/components/article-view";
import { LinkButton, PageHeader } from "@/components/ui";

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
  const languages = await listLanguages();

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
      <ArticleView key={article.id} article={article} languages={languages} />
    </div>
  );
}
