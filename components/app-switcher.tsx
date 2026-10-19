"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { appHomePath, appKindLabel } from "@/lib/catalog";
import type { SidebarApp } from "@/lib/app-sections";

const RECENT_KEY = "lingo.recentApps";
const RECENT_MAX = 4;

/** Ids of recently opened apps, newest first. Browser storage only, so it may be empty. */
function readRecent(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((item) => item !== id)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Private window or blocked storage: the list just stays empty. */
  }
}

const TYPE_GROUPS: { type: SidebarApp["model_type"]; label: string }[] = [
  { type: "CONTENT", label: "Articles" },
  { type: "STRING", label: "Product strings" },
  { type: "CATALOG", label: "Catalogs" },
];

function ReviewBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return (
    <span
      title={label}
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--hub-accent-fill)] px-1.5 text-[11px] font-bold text-[var(--hub-on-accent)]"
    >
      {count}
    </span>
  );
}

function reviewLabel(count: number) {
  return `${count} ${count === 1 ? "article needs" : "articles need"} review`;
}

function AppRow({
  app,
  active,
  onPick,
}: {
  app: SidebarApp;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <Link
        href={appHomePath(app)}
        onClick={onPick}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
          active
            ? "bg-[var(--hub-accent-soft)] font-semibold text-[var(--hub-accent)]"
            : "text-slate-700 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{app.name}</span>
          {app.status !== "ACTIVE" ? (
            <span className="block text-[11px] text-[var(--hub-muted)]">Inactive</span>
          ) : null}
        </span>
        <ReviewBadge count={app.reviewCount} label={reviewLabel(app.reviewCount)} />
      </Link>
    </li>
  );
}

function GroupHeading({ label }: { label: string }) {
  return (
    <li
      role="presentation"
      className="px-2 pt-2 pb-0.5 text-[10px] font-semibold tracking-[0.14em] text-[var(--hub-muted-strong)] uppercase"
    >
      {label}
    </li>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 8l4-4 4 4M6 12l4 4 4-4" />
    </svg>
  );
}

/**
 * Picks the application the sidebar is about. Every app shows its own review count,
 * and the closed button shows how many wait in the other apps.
 */
export function AppSwitcher({
  apps,
  current,
  isSuperadmin,
  onNavigate,
}: {
  apps: SidebarApp[];
  current: SidebarApp | null;
  isSuperadmin: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Remember the open app. The list is read when the menu opens.
  useEffect(() => {
    if (current) rememberRecent(current.id);
  }, [current]);

  function toggle(next: boolean) {
    if (next) setRecent(readRecent());
    setOpen(next);
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const elsewhere = apps
    .filter((app) => app.id !== current?.id)
    .reduce((sum, app) => sum + app.reviewCount, 0);

  const term = query.trim().toLowerCase();
  const matches = useMemo(
    () => (term ? apps.filter((app) => app.name.toLowerCase().includes(term)) : apps),
    [apps, term]
  );
  const recentApps = term
    ? []
    : recent
        .map((id) => apps.find((app) => app.id === id))
        .filter((app): app is SidebarApp => !!app && app.id !== current?.id);

  function close() {
    setOpen(false);
    setQuery("");
    onNavigate?.();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => toggle(!open)}
        // The colour sits on the switcher itself: the app you are in.
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--hub-sidebar-active-border)] bg-[var(--hub-accent-soft)] px-3 py-2 text-left shadow-sm transition outline-none hover:border-[var(--hub-accent)] focus-visible:border-[var(--hub-accent)] focus-visible:ring-2 focus-visible:ring-[var(--hub-accent-ring)]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">
            {current ? current.name : "Choose an application"}
          </span>
          <span className="block truncate text-[11px] text-[var(--hub-muted)]">
            {current ? appKindLabel(current) : `${apps.length} available`}
          </span>
        </span>
        {elsewhere > 0 ? (
          <span
            className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--hub-accent-fill)]"
            title={`${reviewLabel(elsewhere)} in your other applications`}
          >
            <span className="sr-only">{reviewLabel(elsewhere)} in your other applications</span>
          </span>
        ) : null}
        <span className="text-slate-400">
          <ChevronIcon />
        </span>
      </button>
      {elsewhere > 0 && !open ? (
        <button
          type="button"
          onClick={() => toggle(true)}
          className="mt-1 w-full px-1 text-left text-[11px] font-medium text-[var(--hub-accent)] hover:underline"
        >
          {reviewLabel(elsewhere)} in other apps
        </button>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Switch application"
          className="absolute inset-x-0 z-30 mt-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an application"
            aria-label="Find an application"
            className="mb-1 h-8 w-full rounded-md border border-[var(--hub-border-strong)] bg-white px-2 text-sm text-[var(--hub-fg)] outline-none placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--hub-accent)] focus:ring-2 focus:ring-[var(--hub-accent-ring)]"
          />
          <ul className="max-h-[min(24rem,60dvh)] space-y-0.5 overflow-auto">
            {recentApps.length > 0 ? (
              <>
                <GroupHeading label="Recent" />
                {recentApps.map((app) => (
                  <AppRow key={`recent:${app.id}`} app={app} active={false} onPick={close} />
                ))}
              </>
            ) : null}
            {TYPE_GROUPS.map((group) => {
              const list = matches.filter((app) => app.model_type === group.type);
              if (list.length === 0) return null;
              return (
                <Fragment key={group.type}>
                  <GroupHeading label={group.label} />
                  {list.map((app) => (
                    <AppRow key={app.id} app={app} active={app.id === current?.id} onPick={close} />
                  ))}
                </Fragment>
              );
            })}
            {matches.length === 0 ? (
              <li className="px-2 py-2 text-sm text-[var(--hub-muted)]">No application matches.</li>
            ) : null}
          </ul>
          {isSuperadmin ? (
            <div className="mt-1 border-t border-[var(--hub-border)] px-2 pt-2 text-xs">
              <Link href="/applications/new" onClick={close} className="font-semibold text-[var(--hub-accent)] hover:underline">
                New application
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
