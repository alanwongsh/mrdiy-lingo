"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { itemLabelPlural } from "@/lib/catalog";
import type { AppAccess, Application } from "@/lib/types";

export function AppSubnav({
  application,
}: {
  application: Pick<Application, "id" | "model_type" | "item_label"> & {
    access?: Pick<AppAccess, "can_manage" | "permissions">;
  };
}) {
  const pathname = usePathname();
  const base = `/applications/${application.id}`;
  // CONTENT reaches Roles and Details through its Settings tabs.
  const rolesLink = application.access?.permissions?.includes("roles.manage")
    ? { href: `${base}/settings/roles`, label: "Roles" }
    : null;
  // Shown while access is unknown, so pages that pass no access keep their Import tab.
  const canImport = !application.access || application.access.permissions.includes("content.import");
  const detailsLink = application.access?.permissions?.includes("settings.general")
    ? { href: `${base}/edit`, label: "Details" }
    : null;
  const links =
    application.model_type === "STRING"
      ? [
          { href: base, label: "Overview", exact: true },
          { href: `${base}/translations`, label: "Translations" },
          { href: `${base}/namespaces`, label: "Namespaces" },
          ...(canImport ? [{ href: `${base}/import`, label: "Import" }] : []),
          ...(detailsLink ? [detailsLink] : []),
          ...(rolesLink ? [rolesLink] : []),
        ]
      : application.model_type === "CATALOG"
        ? [
            { href: `${base}/items`, label: itemLabelPlural(application), exclude: `${base}/items/import` },
            ...(canImport ? [{ href: `${base}/items/import`, label: "Import" }] : []),
            { href: `${base}/fields`, label: "Fields" },
            ...(application.access?.can_manage
              ? [{ href: `${base}/settings/people`, label: "People" }]
              : []),
            ...(detailsLink ? [detailsLink] : []),
            ...(rolesLink ? [rolesLink] : []),
          ]
        : [
            { href: `${base}/articles`, label: "Articles" },
            ...(canImport ? [{ href: `${base}/import`, label: "Import" }] : []),
            { href: `${base}/settings`, label: "Settings" },
          ];

  return (
    <nav aria-label="Application sections" className="mb-6">
      <div className="overflow-x-auto sm:overflow-visible">
        <div className="grid w-max min-w-full grid-flow-col auto-cols-[minmax(7.25rem,1fr)] gap-1 rounded-xl border border-[var(--hub-border)] bg-white p-1 shadow-[var(--hub-shadow)] sm:inline-grid sm:w-auto sm:min-w-0 sm:auto-cols-auto">
          {links.map((link) => {
            const excluded =
              "exclude" in link && link.exclude ? pathname.startsWith(link.exclude) : false;
            const active =
              !excluded &&
              ("exact" in link && link.exact
                ? pathname === link.href
                : pathname === link.href || pathname.startsWith(`${link.href}/`));
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
