"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SettingsTabs({ applicationId }: { applicationId: string }) {
  const pathname = usePathname();
  const base = `/applications/${applicationId}/settings`;
  const tabs = [
    { href: `${base}/types`, label: "Types" },
    { href: `${base}/publish`, label: "Publish" },
    { href: `${base}/quality`, label: "Quality" },
    { href: `${base}/notifications`, label: "Notifications" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Settings"
      className="mb-4 flex w-fit gap-1 rounded-lg border border-[var(--hub-border)] bg-white p-1 shadow-[var(--hub-shadow)]"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
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
