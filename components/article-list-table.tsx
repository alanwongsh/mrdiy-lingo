"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteArticles, exportArticlesFile } from "@/lib/actions/press";
import type { ArticleListItem } from "@/lib/actions/press";
import type { Language } from "@/lib/types";
import { DeleteArticleButton } from "@/components/delete-article-button";
import { PublishDueCell } from "@/components/publish-due-cell";
import { Badge, Button, Card, LinkButton, statusTone } from "@/components/ui";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const allSelected =
    pageIds.length > 0 && selectedOnPage.length === pageIds.length;
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={pending || selectedOnPage.length === 0}
          onClick={runExport}
        >
          {task === "export"
            ? "Exporting…"
            : selectedOnPage.length > 0
              ? `Export selected (${selectedOnPage.length})`
              : "Export selected"}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={pending || selectedOnPage.length === 0}
          onClick={runBulkDelete}
        >
          {task === "delete"
            ? "Deleting…"
            : selectedOnPage.length > 0
              ? `Delete selected (${selectedOnPage.length})`
              : "Delete selected"}
        </Button>
        {selectedOnPage.length > 0 ? (
          <button
            type="button"
            className="text-sm text-[var(--hub-muted)] underline-offset-2 hover:underline"
            disabled={pending}
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        ) : (
          <span className="text-sm text-[var(--hub-muted)]">
            Select articles to export or delete
          </span>
        )}
        {error ? (
          <span className="text-sm text-red-700" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      {notice ? (
        <p className="text-sm text-amber-800" role="status">
          {notice}
        </p>
      ) : null}

      <Card className="overflow-hidden">
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
              <th>Source</th>
              <th>Type</th>
              <th>Status</th>
              <th>Languages</th>
              <th>Due</th>
              <th>Published</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {articles.map((article) => {
              const byLang = new Map(
                article.translations.map((t) => [t.language_code, t])
              );
              const isChecked = selected.has(article.id);
              return (
                <tr
                  key={article.id}
                  className="border-b border-[var(--hub-border)] align-top"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${article.title}`}
                      checked={isChecked}
                      disabled={pending}
                      onChange={() => toggleOne(article.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/applications/${applicationId}/articles/${article.id}`}
                      className="font-medium text-[var(--hub-accent)] hover:underline"
                    >
                      {article.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="info">
                      {(
                        languages.find(
                          (l) => l.code === article.source_language
                        )?.code ?? article.source_language
                      ).toUpperCase()}
                    </Badge>
                    <div className="mt-1 text-xs text-[var(--hub-muted)]">
                      {languages.find((l) => l.code === article.source_language)
                        ?.name ?? article.source_language}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="neutral">{article.content_type}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(article.status)}>
                      {article.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(article.target_languages?.length
                        ? article.target_languages
                        : []
                      ).map((code) => {
                        const lang = languages.find((l) => l.code === code);
                        const row = byLang.get(code);
                        const label = row
                          ? row.status === "SYSTEM_GENERATED"
                            ? "Auto"
                            : row.status === "MANUALLY_MODIFIED"
                              ? "Edited"
                              : row.status === "APPROVED"
                                ? "Approved"
                                : "Missing"
                          : "Missing";
                        const tone = row
                          ? statusTone(row.status)
                          : ("neutral" as const);
                        return (
                          <Badge key={code} tone={tone}>
                            {(lang?.code ?? code).toUpperCase()} · {label}
                          </Badge>
                        );
                      })}
                      {!article.target_languages?.length ? (
                        <span className="text-xs text-[var(--hub-muted)]">
                          No target languages set
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <PublishDueCell
                      scheduledPublishAt={article.scheduled_publish_at}
                      publishedAt={article.published_at}
                      status={article.status}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--hub-muted)]">
                    {formatDate(article.published_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--hub-muted)]">
                    {formatDate(article.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <LinkButton
                        href={`/applications/${applicationId}/articles/${article.id}`}
                        variant="secondary"
                      >
                        Open
                      </LinkButton>
                      <DeleteArticleButton
                        applicationId={applicationId}
                        contentId={article.id}
                        title={article.title}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {articles.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-[var(--hub-muted)]"
                >
                  No articles yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
