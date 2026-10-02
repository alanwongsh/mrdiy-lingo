import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSubnav } from "@/components/app-subnav";
import {
  Badge,
  Card,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { getApplication } from "@/lib/actions/applications";
import { getProductStats } from "@/lib/actions/product";
import { getPressStats } from "@/lib/actions/press";

export default async function ApplicationOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await getApplication(id);
  if (!app) notFound();

  const isString = app.model_type === "STRING";
  const productStats = isString ? await getProductStats(id) : null;
  const pressStats = !isString ? await getPressStats(id) : null;
  const base = `/applications/${id}`;

  return (
    <div>
      <PageHeader
        title={app.name}
        description={
          app.description ||
          (isString
            ? "String translations organized by namespace and key."
            : "Long-form article and content translations.")
        }
        actions={
          <>
            <Badge tone={app.status === "ACTIVE" ? "good" : "neutral"}>
              {app.status}
            </Badge>
            <Badge tone="info">
              {isString ? "String model" : "Content model"}
            </Badge>
          </>
        }
      />
      <AppSubnav application={app} />

      {isString && productStats ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Translation keys"
            value={productStats.translationKeys}
            tone="accent"
          />
          <StatCard
            label="Translated"
            value={productStats.translated}
            tone="good"
          />
          <StatCard
            label="Missing"
            value={productStats.missing}
            tone={productStats.missing > 0 ? "warn" : "default"}
          />
        </div>
      ) : null}

      {!isString && pressStats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Articles" value={pressStats.articles} tone="accent" />
          <StatCard label="Published" value={pressStats.published} tone="good" />
          <StatCard label="In review" value={pressStats.inReview} tone="info" />
          <StatCard label="Draft" value={pressStats.draft} />
          <StatCard label="Translating" value={pressStats.translating} tone="info" />
          <StatCard label="Approved" value={pressStats.approved} tone="good" />
        </div>
      ) : null}

      <Card className="mt-8 p-5">
        <h2 className="font-semibold text-slate-900">How this app works</h2>
        {isString ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Product uses <strong>key/value string translations</strong>. Use{" "}
            <Link
              href={`${base}/translations`}
              className="hub-accent-link font-semibold"
            >
              Translations
            </Link>{" "}
            to search and edit keys.{" "}
            <Link
              href={`${base}/namespaces`}
              className="hub-accent-link font-semibold"
            >
              Namespaces
            </Link>{" "}
            are only for organizing keys (Checkout, Cart, etc.) — they do not
            change uniqueness. Create new keys from the Translations page or via
            Import.
          </p>
        ) : (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Press uses <strong>article/content translations</strong>. Manage
            long-form pieces under{" "}
            <Link
              href={`${base}/articles`}
              className="hub-accent-link font-semibold"
            >
              Articles
            </Link>
            , then translate title, description, and HTML body per language.
          </p>
        )}
      </Card>
    </div>
  );
}
