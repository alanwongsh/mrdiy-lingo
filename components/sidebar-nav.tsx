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

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
              active
                ? "border-[var(--hub-sidebar-active-border)] bg-[var(--hub-sidebar-active)] font-semibold text-[var(--hub-sidebar-fg)]"
                : "border-transparent text-[var(--hub-sidebar-fg)] hover:bg-[var(--hub-sidebar-hover)]"
            }`}
          >
            <span className="min-w-0">
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
            </span>
            {item.badge ? (
              <span
                className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--diy-red)] px-1.5 text-[11px] font-bold text-white"
              >
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
