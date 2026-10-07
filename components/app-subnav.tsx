"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Application } from "@/lib/types";

export function AppSubnav({
  application,
}: {
  application: Pick<Application, "id" | "model_type">;
}) {
  const pathname = usePathname();
  const base = `/applications/${application.id}`;
  const links =
    application.model_type === "STRING"
      ? [
          { href: base, label: "Overview", exact: true },
          { href: `${base}/translations`, label: "Translations" },
          { href: `${base}/namespaces`, label: "Namespaces" },
          { href: `${base}/import`, label: "Import" },
        ]
      : [
          { href: `${base}/articles`, label: "Articles" },
          { href: base, label: "Overview", exact: true },
          { href: `${base}/import`, label: "Import" },
          { href: `${base}/settings`, label: "Settings" },
        ];

  return (
    <nav aria-label="Application sections" className="mb-6">
      <div className="overflow-x-auto sm:overflow-visible">
        <div className="grid w-max min-w-full grid-flow-col auto-cols-[minmax(7.25rem,1fr)] gap-1 rounded-xl border border-[var(--hub-border)] bg-white p-1 shadow-[var(--hub-shadow)] sm:inline-grid sm:w-auto sm:min-w-0 sm:auto-cols-auto">
          {links.map((link) => {
            const active = link.exact
              ? pathname === link.href
              : pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-center text-sm font-medium whitespace-nowrap transition sm:px-3.5 sm:text-left ${
                  active
                    ? "bg-[var(--diy-red)] text-white shadow-sm"
                    : "text-slate-600 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
