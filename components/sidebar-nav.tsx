"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SidebarNav({
  items,
}: {
  items: { href: string; label: string; hint?: string }[];
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-1">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : item.href === "/applications"
              ? pathname === "/applications" ||
                pathname === "/applications/new" ||
                /^\/applications\/[^/]+\/edit$/.test(pathname)
              : pathname === item.href ||
                pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`block rounded-lg px-3 py-2.5 text-sm transition ${
              active
                ? "bg-[var(--hub-sidebar-active)] font-semibold text-white shadow-sm"
                : "text-[var(--hub-sidebar-fg)] hover:bg-[var(--hub-sidebar-hover)]"
            }`}
          >
            <span className="block">{item.label}</span>
            {item.hint ? (
              <span
                className={`mt-0.5 block text-[11px] ${
                  active ? "text-white/85" : "text-[var(--hub-sidebar-muted)]"
                }`}
              >
                {item.hint}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
