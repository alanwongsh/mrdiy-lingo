import { notFound } from "next/navigation";
import { getApplication } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import { getArticle } from "@/lib/actions/press";
import { AppSubnav } from "@/components/app-subnav";
import { ArticleEditor } from "@/components/article-editor";
import { PageHeader } from "@/components/ui";

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
        description={`Status: ${article.status}`}
        back={{
          href: `/applications/${id}/articles`,
          label: "Back to articles",
        }}
      />
      <AppSubnav application={app} />
      <ArticleEditor
        applicationId={app.id}
        article={article}
        languages={languages}
      />
    </div>
  );
}
