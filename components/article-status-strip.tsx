import Link from "next/link";
import type { ContentLifecycleStatus } from "@/lib/types";

type PressStats = {
  articles: number;
  published: number;
  inReview: number;
  draft: number;
  translating: number;
  approved: number;
  publishing: number;
};

/** Article counts by status. Each one filters the list below; the other filters are kept. */
export function ArticleStatusStrip({
  applicationId,
  stats,
  active,
  query,
}: {
  applicationId: string;
  stats: PressStats;
  active: string;
  /** Current filters other than status and page. */
  query: Record<string, string | undefined>;
}) {
  const items: { status: ContentLifecycleStatus | ""; label: string; count: number }[] = [
    { status: "", label: "All", count: stats.articles },
    { status: "REVIEW", label: "In review", count: stats.inReview },
    { status: "DRAFT", label: "Draft", count: stats.draft },
    { status: "TRANSLATING", label: "Translating", count: stats.translating },
    { status: "APPROVED", label: "Approved", count: stats.approved },
    { status: "PUBLISHING", label: "Publishing", count: stats.publishing },
    { status: "PUBLISHED", label: "Published", count: stats.published },
  ];

  function href(status: string) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    if (status) params.set("status", status);
    const search = params.toString();
    return `/applications/${applicationId}/articles${search ? `?${search}` : ""}`;
  }

  return (
    <nav aria-label="Articles by status" className="mb-4 flex flex-wrap gap-2">
      {items.map((item) => {
        const selected = item.status === active;
        return (
          <Link
            key={item.label}
            href={href(item.status)}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              selected
                ? "border-[var(--diy-red)] bg-[var(--diy-red)] text-white"
                : "border-[var(--hub-border)] bg-white text-slate-700 hover:border-[var(--hub-border-strong)] hover:bg-[var(--diy-yellow-soft)]"
            }`}
          >
            {item.label}
            <span
              className={`tabular-nums ${selected ? "text-white/90" : "text-[var(--hub-muted)]"}`}
            >
              {item.count.toLocaleString()}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
