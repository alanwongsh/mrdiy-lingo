"use client";

import { useEffect, useRef } from "react";

/**
 * A settings block that folds to its header, styled like the article editor's
 * Source panel: a red ▸ / ▾, the title as a small red label, and a summary line under it.
 * Opens on its own when the page is reached with #id, so deep links still land on it.
 */
export function CollapsibleSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  /** One short line under the title, such as "128 words". */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (id && ref.current && window.location.hash === `#${id}`) {
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    }
  }, [id]);

  return (
    <details
      ref={ref}
      id={id}
      open={defaultOpen}
      className="group scroll-mt-6 overflow-hidden rounded-xl border border-[var(--hub-border)] bg-[var(--hub-panel)] shadow-[var(--hub-shadow)]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-slate-50 px-4 py-3 select-none group-open:border-b group-open:border-[var(--hub-border)] [&::-webkit-details-marker]:hidden">
        <span className="text-[var(--hub-accent)]" aria-hidden>
          <span className="group-open:hidden">▸</span>
          <span className="hidden group-open:inline">▾</span>
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold tracking-wide text-[var(--hub-accent)] uppercase">
            {title}
          </span>
          {summary ? (
            <span className="mt-0.5 block truncate font-semibold text-slate-900">{summary}</span>
          ) : null}
        </span>
      </summary>
      <div className="p-4">{children}</div>
    </details>
  );
}
