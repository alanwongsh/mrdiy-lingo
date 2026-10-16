"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SidebarNav({
  items,
  onNavigate,
}: {
  items: {
    href: string;
    label: string;
    hint?: string;
    match?: string;
    badge?: number;
    /** Where the badge goes, such as the list filtered to what it counts. */
    badgeHref?: string;
    /** Accessible name and hover text for the badge link. */
    badgeLabel?: string;
  }[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-1">
      {items.map((item) => {
        const target = item.match ?? item.href;
        const active =
          target === "/"
            ? pathname === "/"
            : target === "/applications"
              ? pathname === "/applications" ||
                pathname === "/applications/new" ||
                /^\/applications\/[^/]+\/edit$/.test(pathname)
              : pathname === target || pathname.startsWith(`${target}/`);
        const badgeClass =
          "mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--hub-accent-fill)] px-1.5 text-[11px] font-bold text-[var(--hub-on-accent)]";

        // Two links side by side, not nested: the row opens the app, the badge opens the filtered list.
        return (
          <div
            key={item.href}
            className={`flex items-start justify-between rounded-lg border text-sm transition ${
              active
                ? "border-[var(--hub-sidebar-active-border)] bg-[var(--hub-sidebar-active)] font-semibold text-[var(--hub-sidebar-fg)]"
                : "border-transparent text-[var(--hub-sidebar-fg)] hover:bg-[var(--hub-sidebar-hover)]"
            }`}
          >
            <Link
              href={item.href}
              onClick={onNavigate}
              className="min-w-0 flex-1 px-3 py-2.5"
            >
              <span className="block">{item.label}</span>
              {item.hint ? (
                <span
                  className={`mt-0.5 block text-[11px] ${
                    active
                      ? "font-medium text-[var(--hub-sidebar-fg)] opacity-75"
                      : "text-[var(--hub-sidebar-muted)]"
                  }`}
                >
                  {item.hint}
                </span>
              ) : null}
            </Link>
            {item.badge ? (
              item.badgeHref ? (
                <Link
                  href={item.badgeHref}
                  onClick={onNavigate}
                  aria-label={item.badgeLabel}
                  title={item.badgeLabel}
                  className={`${badgeClass} mt-3 mr-3 hover:ring-2 hover:ring-[var(--hub-accent)] hover:ring-offset-1`}
                >
                  {item.badge}
                </Link>
              ) : (
                <span className={`${badgeClass} mt-3 mr-3`}>{item.badge}</span>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
