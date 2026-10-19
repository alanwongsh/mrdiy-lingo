"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Settings pages. A menu down the left on wide screens; a row of soft pills on narrow ones.
 * Lighter than the section tabs above it, so the two levels read apart.
 */
export function SettingsTabs({
  applicationId,
  canManage,
  canManageRoles,
  publishing,
}: {
  applicationId: string;
  /** People is shown to people with people.manage. */
  canManage: boolean;
  /** Roles and Business units are shown to people with roles.manage. */
  canManageRoles: boolean;
  /** False while publishing is switched off. */
  publishing: boolean;
}) {
  const pathname = usePathname();
  const base = `/applications/${applicationId}/settings`;
  const tabs = [
    { href: `${base}/general`, label: "General" },
    ...(canManage ? [{ href: `${base}/people`, label: "People" }] : []),
    ...(canManageRoles ? [{ href: `${base}/roles`, label: "Roles" }] : []),
    ...(canManageRoles
      ? [{ href: `${base}/business-units`, label: "Business units" }]
      : []),
    { href: `${base}/quality`, label: publishing ? "Quality & publishing" : "Quality" },
  ];

  return (
    // self-start keeps the menu its own height, so it can stick while the page scrolls.
    <nav aria-label="Settings" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition lg:border-l-2 lg:rounded-l-none ${
                  active
                    ? "bg-[var(--hub-accent-soft)] font-semibold text-[var(--hub-accent)] lg:border-[var(--hub-accent)]"
                    : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:border-transparent"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
