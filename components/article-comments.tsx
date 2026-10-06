"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addArticleComment } from "@/lib/actions/comments";
import type { ArticleComment, Language } from "@/lib/types";
import { Button, textareaClass } from "@/components/ui";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ArticleComments({
  applicationId,
  contentId,
  comments,
  languages,
  activeLanguage,
  actor,
  loadError,
}: {
  applicationId: string;
  contentId: string;
  comments: ArticleComment[];
  languages: Language[];
  activeLanguage: string;
  actor: { username: string; name: string } | null;
  loadError?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [languageCode, setLanguageCode] = useState(activeLanguage);
  const [error, setError] = useState("");

  useEffect(() => {
    setLanguageCode(activeLanguage);
  }, [activeLanguage]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const languageName = (code: string) =>
    languages.find((l) => l.code.trim().toLowerCase() === code.trim().toLowerCase())
      ?.name ?? code;

  const visible = useMemo(
    () =>
      comments.filter(
        (comment) =>
          (comment.language_code ?? "").trim().toLowerCase() ===
          languageCode.trim().toLowerCase()
      ),
    [comments, languageCode]
  );
  const activeCount = comments.filter(
    (comment) =>
      (comment.language_code ?? "").trim().toLowerCase() ===
      activeLanguage.trim().toLowerCase()
  ).length;

  return (
    <>
      <button
        type="button"
        className={`fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--diy-red)] text-white shadow-[0_8px_24px_rgba(227,6,19,0.35)] transition hover:bg-[var(--hub-accent-hover)] ${
          open ? "right-full max-sm:hidden sm:right-[24rem]" : "right-[max(1.5rem,env(safe-area-inset-right))]"
        }`}
        aria-expanded={open}
        aria-controls="article-comments"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sr-only">
          {open ? "Close comments" : "Comments"}
        </span>
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 8h10M7 12h6M6 19l-2 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6z"
          />
        </svg>
        {activeCount > 0 ? (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--diy-yellow)] px-1 text-[10px] font-bold text-slate-900">
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-900/20"
          aria-label="Close comments"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {open ? (
        <aside
          id="article-comments"
          role="dialog"
          aria-label="Comments"
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[var(--hub-border)] bg-white pt-[env(safe-area-inset-top)] shadow-[-12px_0_40px_rgba(15,23,42,0.12)] sm:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
            <div>
              <h2 className="font-semibold text-slate-900">Comments</h2>
              <p className="text-xs text-slate-500">
                {languageName(languageCode)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="border-b border-[var(--hub-border)] px-4 py-3">
            <label className="mb-1 block text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Language
            </label>
            <select
              className="h-9 w-full rounded-lg border border-[var(--hub-border-strong)] bg-white px-2 text-sm"
              value={languageCode}
              onChange={(event) => setLanguageCode(event.target.value)}
            >
              {languages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                  {language.code === activeLanguage ? " · editing" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loadError ? (
              <p className="text-sm text-red-700">
                {loadError}. Run migration 005 if the comments table is missing.
              </p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-slate-600">
                No comments on {languageName(languageCode)} yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map((comment) => (
                  <li
                    key={comment.id}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-slate-900">
                        {comment.author_name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {comment.author_username}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">
                        {formatWhen(comment.created_at)}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-800">
                      {comment.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            className="space-y-2 border-t border-[var(--hub-border)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            onSubmit={(event) => {
              event.preventDefault();
              if (!actor || !languageCode) return;
              startTransition(async () => {
                setError("");
                try {
                  await addArticleComment({
                    applicationId,
                    contentId,
                    body,
                    languageCode,
                  });
                  setBody("");
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Comment failed");
                }
              });
            }}
          >
            <textarea
              className={textareaClass}
              rows={3}
              value={body}
              disabled={!actor || pending}
              placeholder={
                actor
                  ? `Comment on ${languageName(languageCode)} as ${actor.name}`
                  : "Sign in to comment"
              }
              onChange={(event) => setBody(event.target.value)}
            />
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {!actor ? (
              <p className="text-xs text-slate-500">
                Joget sign-in is required so the comment shows your name.
              </p>
            ) : null}
            <Button type="submit" disabled={!actor || pending || !body.trim()}>
              {pending ? "Posting…" : "Comment"}
            </Button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
