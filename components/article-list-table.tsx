"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteArticle, deleteArticles, exportArticlesFile } from "@/lib/actions/press";
import type { ArticleListItem } from "@/lib/actions/press";
import { getPublishDueState } from "@/lib/publish-due";
import type { ContentLifecycleStatus, ContentType, Language } from "@/lib/types";
import { Badge, Button, Card, statusTone } from "@/components/ui";
import { marketName } from "@/lib/markets";

const STATUS_LABEL: Record<ContentLifecycleStatus, string> = {
  DRAFT: "Draft",
  TRANSLATING: "Translating",
  REVIEW: "Review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
};

const TYPE_LABEL: Record<ContentType, string> = {
  ARTICLE: "Article",
  NEWS: "News",
  ANNOUNCEMENT: "Announcement",
};

function excerpt(article: ArticleListItem) {
  const raw = article.source_content?.summary ?? "";
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatWhen(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function IconButton({
  label,
  onClick,
  href,
  danger,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const className = `inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--hub-muted-strong)] hover:bg-[var(--hub-accent-soft)] disabled:opacity-40 ${
    danger
      ? "hover:bg-red-50 hover:text-red-700"
      : "hover:text-[var(--hub-accent)]"
  }`;
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path strokeLinecap="round" d="M13.5 6.5l3 3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5h6v2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l1 12h8l1-12" />
    </svg>
  );
}

function translationLine(article: ArticleListItem) {
  const targets = article.target_languages ?? [];
  if (targets.length === 0) return "No translations";
  const approved = new Set(
    article.translations
      .filter((row) => row.status === "APPROVED")
      .map((row) => row.language_code.toLowerCase())
  );
  const ready = targets.filter((code) => approved.has(code.toLowerCase())).length;
  return `${ready} of ${targets.length} approved`;
}

export function ArticleListTable({
  applicationId,
  articles,
  languages,
}: {
  applicationId: string;
  articles: ArticleListItem[];
  languages: Language[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [task, setTask] = useState<"" | "export" | "delete">("");

  const pageIds = useMemo(() => articles.map((a) => a.id), [articles]);
  const selectedOnPage = pageIds.filter((id) => selected.has(id));
  const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  function downloadWorkbook(filename: string, base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function runExport() {
    if (selectedOnPage.length === 0) return;
    setError("");
    setNotice("");
    setTask("export");
    startTransition(async () => {
      try {
        const file = await exportArticlesFile({
          applicationId,
          contentIds: selectedOnPage,
        });
        downloadWorkbook(file.filename, file.base64);
        setNotice(file.notice);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Export failed");
      } finally {
        setTask("");
      }
    });
  }

  function runDelete(article: ArticleListItem) {
    if (
      !confirm(
        `Delete “${article.title}”? Translations and version history will be removed.`
      )
    ) {
      return;
    }
    setError("");
    setTask("delete");
    startTransition(async () => {
      try {
        await deleteArticle({
          contentId: article.id,
          applicationId,
        });
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(article.id);
          return next;
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      } finally {
        setTask("");
      }
    });
  }

  function runBulkDelete() {
    if (selectedOnPage.length === 0) return;
    const count = selectedOnPage.length;
    if (
      !confirm(
        `Delete ${count} article${count === 1 ? "" : "s"}? Translations and version history will be removed.`
      )
    ) {
      return;
    }
    setError("");
    setTask("delete");
    startTransition(async () => {
      try {
        await deleteArticles({
          contentIds: selectedOnPage,
          applicationId,
        });
        setSelected(new Set());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Bulk delete failed");
      } finally {
        setTask("");
      }
    });
  }

  return (
    <Card className="overflow-hidden">
      {selectedOnPage.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hub-border)] px-4 py-3">
          <span className="text-sm text-[var(--hub-muted-strong)]">
            {selectedOnPage.length} selected
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={runExport}
          >
            {task === "export" ? "Exporting…" : "Export"}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={runBulkDelete}
          >
            {task === "delete" ? "Deleting…" : "Delete"}
          </Button>
          <button
            type="button"
            className="text-sm text-[var(--hub-muted)] underline-offset-2 hover:underline"
            disabled={pending}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="px-4 pt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="px-4 pt-3 text-sm text-amber-800" role="status">
          {notice}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="hub-table">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all articles on this page"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  disabled={pageIds.length === 0 || pending}
                  onChange={toggleAll}
                />
              </th>
              <th>Article</th>
              <th>Market</th>
              <th className="hidden md:table-cell">Type</th>
              <th className="hidden sm:table-cell">State</th>
              <th className="hidden lg:table-cell">Submitted by</th>
              <th className="hidden xl:table-cell">Translations</th>
              <th className="hidden sm:table-cell text-right">When</th>
              <th className="w-20 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {articles.map((article) => {
              const summary = excerpt(article);
              const sourceName =
                languages.find(
                  (language) =>
                    language.code.toLowerCase() === article.source_language.toLowerCase()
                )?.name ?? article.source_language;
              const due = getPublishDueState(
                article.scheduled_publish_at,
                article.status,
                article.published_at
              );
              const href = `/applications/${applicationId}/articles/${article.id}`;
              return (
                <tr key={article.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${article.title}`}
                      checked={selected.has(article.id)}
                      disabled={pending}
                      onChange={() => toggleOne(article.id)}
                    />
                  </td>
                  <td>
                    <Link href={href} className="block font-semibold text-[var(--diy-red)] hover:text-[var(--diy-red-dark)] hover:underline">
                      {article.title}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 max-w-md text-xs text-[var(--hub-muted)]">
                      {sourceName}
                      {summary ? ` · ${summary}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:hidden">
                      <Badge tone={statusTone(article.status)}>
                        {STATUS_LABEL[article.status]}
                      </Badge>
                      <span className="text-xs text-[var(--hub-muted)]">
                        {article.market ? `${article.market} · ` : ""}
                        {formatWhen(article.updated_at)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="text-sm font-bold tracking-wide text-[var(--hub-fg)]">
                      {article.market || "—"}
                    </div>
                    <div className="text-[11px] font-semibold tracking-wide text-[var(--hub-muted)] uppercase">
                      {article.market ? marketName(article.market) : sourceName}
                    </div>
                  </td>
                  <td className="hidden text-sm text-[var(--hub-muted-strong)] md:table-cell">
                    {TYPE_LABEL[article.content_type]}
                  </td>
                  <td className="hidden sm:table-cell">
                    <Badge tone={statusTone(article.status)}>
                      {STATUS_LABEL[article.status]}
                    </Badge>
                  </td>
                  <td className="hidden text-sm text-[var(--hub-muted-strong)] lg:table-cell">
                    {article.submitted_by_name || "—"}
                  </td>
                  <td className="hidden text-sm text-[var(--hub-muted-strong)] xl:table-cell">
                    {translationLine(article)}
                  </td>
                  <td className="hidden text-right sm:table-cell">
                    <div className="text-sm text-[var(--hub-muted-strong)]">
                      {formatWhen(article.updated_at)}
                    </div>
                    {due.kind === "overdue" || due.kind === "due_soon" ? (
                      <div
                        className={`mt-0.5 text-xs ${
                          due.kind === "overdue" ? "text-red-700" : "text-amber-800"
                        }`}
                      >
                        {due.label}
                        {due.countdown ? ` · ${due.countdown}` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      <IconButton
                        label={`Edit ${article.title}`}
                        href={`/applications/${applicationId}/articles/${article.id}/edit`}
                      >
                        <PencilIcon />
                      </IconButton>
                      <IconButton
                        label={`Delete ${article.title}`}
                        danger
                        disabled={pending}
                        onClick={() => runDelete(article)}
                      >
                        <TrashIcon />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
            {articles.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-sm text-[var(--hub-muted)]">
                  No articles found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
