"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsTabs({
  applicationId,
  canManage,
  canManageRoles,
}: {
  applicationId: string;
  /** People is shown to people with people.manage. */
  canManage: boolean;
  /** Roles is shown to people with roles.manage. */
  canManageRoles: boolean;
}) {
  const pathname = usePathname();
  const base = `/applications/${applicationId}/settings`;
  const tabs = [
    { href: `${base}/general`, label: "General" },
    ...(canManage ? [{ href: `${base}/people`, label: "People" }] : []),
    ...(canManageRoles ? [{ href: `${base}/roles`, label: "Roles" }] : []),
    { href: `${base}/quality`, label: "Quality & publishing" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Settings"
      className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-[var(--hub-border)] bg-white p-1 shadow-[var(--hub-shadow)]"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition ${
              active
                ? "bg-[var(--diy-red)] text-white shadow-sm"
                : "text-slate-600 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
