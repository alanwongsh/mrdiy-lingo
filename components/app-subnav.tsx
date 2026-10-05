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
          { href: base, label: "Overview", exact: true },
          { href: `${base}/articles`, label: "Articles" },
          { href: `${base}/import`, label: "Import" },
        ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-[var(--hub-border)] bg-white p-1.5 shadow-[var(--hub-shadow)] sm:flex sm:flex-wrap">
      {links.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3.5 py-2 text-center text-sm font-medium transition sm:text-left ${
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
  );
}
