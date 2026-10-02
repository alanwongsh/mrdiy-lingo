import Link from "next/link";
import { listApplications } from "@/lib/actions/applications";
import { listLanguages } from "@/lib/actions/languages";
import { getProductStats } from "@/lib/actions/product";
import { getPressStats } from "@/lib/actions/press";
import { LinkButton, PageHeader, StatCard, Card, Badge } from "@/components/ui";

export default async function DashboardPage() {
  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  let languages: Awaited<ReturnType<typeof listLanguages>> = [];
  let dbReady = true;
  let errorMessage = "";

  try {
    apps = await listApplications({ includeInactive: true });
    languages = await listLanguages({ includeInactive: true });
  } catch (e) {
    dbReady = false;
    errorMessage = e instanceof Error ? e.message : "Database not ready";
  }

  const product = apps.find((a) => a.model_type === "STRING");
  const press = apps.find((a) => a.model_type === "CONTENT");

  let productStats = { translationKeys: 0, translated: 0, missing: 0 };
  let pressStats = {
    articles: 0,
    published: 0,
    inReview: 0,
    draft: 0,
    translating: 0,
    approved: 0,
  };

  if (dbReady && product) {
    try {
      productStats = await getProductStats(product.id);
    } catch {
      /* ignore */
    }
  }
  if (dbReady && press) {
    try {
      pressStats = await getPressStats(press.id);
    } catch {
      /* ignore */
    }
  }

  if (!dbReady) {
    return (
      <div>
        <PageHeader
          title="Dashboard"
          description="Set up the database before using Mr DIY Lingo."
        />
        <Card className="p-6">
          <div className="font-medium">Database schema not applied</div>
          <p className="mt-2 text-sm text-[var(--hub-muted)]">{errorMessage}</p>
          <p className="mt-3 text-sm text-[var(--hub-muted)]">
            Open{" "}
            <Link href="/setup" className="text-[var(--hub-accent)] underline">
              Setup
            </Link>{" "}
            and run the SQL migration in your Supabase project.
          </p>
          <div className="mt-4">
            <LinkButton href="/setup">Go to Setup</LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of applications, languages, and translation coverage for Mr DIY Lingo."
        actions={<LinkButton href="/applications/new">New Application</LinkButton>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applications" value={apps.length} tone="accent" />
        <StatCard label="Languages" value={languages.length} tone="info" />
        <StatCard
          label="Product keys"
          value={productStats.translationKeys}
          hint={`${productStats.missing.toLocaleString()} missing`}
          tone={productStats.missing > 0 ? "warn" : "good"}
        />
        <StatCard
          label="Press articles"
          value={pressStats.articles}
          hint={`${pressStats.published.toLocaleString()} published`}
          tone="good"
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] bg-[var(--hub-panel-soft)] px-5 py-3.5">
            <h2 className="font-semibold">Product</h2>
            {product ? (
              <Link
                href={`/applications/${product.id}`}
                className="hub-accent-link rounded-md px-2 py-1 text-sm font-semibold hover:bg-[var(--hub-accent-soft)]"
              >
                Open →
              </Link>
            ) : null}
          </div>
          <dl className="space-y-0 px-5 py-2 text-sm">
            <div className="flex justify-between border-b border-[var(--hub-border)] py-3">
              <dt className="text-[var(--hub-muted-strong)]">Translation keys</dt>
              <dd className="font-semibold tabular-nums">
                {productStats.translationKeys.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between border-b border-[var(--hub-border)] py-3">
              <dt className="text-[var(--hub-muted-strong)]">Translated</dt>
              <dd className="font-semibold tabular-nums text-emerald-700">
                {productStats.translated.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-[var(--hub-muted-strong)]">Missing</dt>
              <dd className="font-semibold tabular-nums text-amber-700">
                {productStats.missing.toLocaleString()}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] bg-[var(--hub-panel-soft)] px-5 py-3.5">
            <h2 className="font-semibold">Press</h2>
            {press ? (
              <Link
                href={`/applications/${press.id}`}
                className="hub-accent-link rounded-md px-2 py-1 text-sm font-semibold hover:bg-[var(--hub-accent-soft)]"
              >
                Open →
              </Link>
            ) : null}
          </div>
          <dl className="space-y-0 px-5 py-2 text-sm">
            <div className="flex justify-between border-b border-[var(--hub-border)] py-3">
              <dt className="text-[var(--hub-muted-strong)]">Articles</dt>
              <dd className="font-semibold tabular-nums">
                {pressStats.articles.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between border-b border-[var(--hub-border)] py-3">
              <dt className="text-[var(--hub-muted-strong)]">Published</dt>
              <dd className="font-semibold tabular-nums text-emerald-700">
                {pressStats.published.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between border-b border-[var(--hub-border)] py-3">
              <dt className="text-[var(--hub-muted-strong)]">In review</dt>
              <dd className="font-semibold tabular-nums text-sky-700">
                {pressStats.inReview.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between py-3">
              <dt className="text-[var(--hub-muted-strong)]">Draft</dt>
              <dd className="font-semibold tabular-nums text-slate-600">
                {pressStats.draft.toLocaleString()}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-[var(--hub-muted-strong)] uppercase">
          Applications
        </h2>
        <div className="space-y-2">
          {apps.map((app) => (
            <Link
              key={app.id}
              href={`/applications/${app.id}`}
              className="hub-accent-link block text-[var(--hub-fg)] no-underline hover:text-[var(--hub-fg)]"
            >
              <Card
                interactive
                className="mb-2 flex items-center justify-between px-4 py-3.5"
              >
                <div>
                  <div className="font-semibold text-slate-900">{app.name}</div>
                  <div className="text-sm text-slate-600">
                    {app.description || "No description"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={app.status === "ACTIVE" ? "good" : "neutral"}>
                    {app.status}
                  </Badge>
                  <Badge tone="info">
                    {app.model_type === "STRING" ? "Strings" : "Content"}
                  </Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
