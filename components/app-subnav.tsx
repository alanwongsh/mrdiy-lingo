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
  // CONTENT reaches Roles through its Settings tabs.
  const rolesLink = application.access?.permissions?.includes("roles.manage")
    ? { href: `${base}/settings/roles`, label: "Roles" }
    : null;
  // Shown while access is unknown, so pages that pass no access keep their Import tab.
  const canImport = !application.access || application.access.permissions.includes("content.import");
  const links =
    application.model_type === "STRING"
      ? [
          { href: base, label: "Overview", exact: true },
          { href: `${base}/translations`, label: "Translations" },
          { href: `${base}/namespaces`, label: "Namespaces" },
          ...(canImport ? [{ href: `${base}/import`, label: "Import" }] : []),
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
            ...(rolesLink ? [rolesLink] : []),
          ]
        : [
            { href: `${base}/articles`, label: "Articles" },
            ...(canImport ? [{ href: `${base}/import`, label: "Import" }] : []),
            { href: `${base}/settings`, label: "Settings" },
          ];

  return (
    <nav aria-label="Application sections" className="mb-6 border-b border-[var(--hub-border)]">
      <div className="-mb-px flex gap-6 overflow-x-auto">
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
                // Underline tabs: the active section is dark text on an orange line.
                className={`border-b-2 px-0.5 pt-1 pb-2.5 text-sm font-semibold whitespace-nowrap transition ${
                  active
                    ? "border-[var(--hub-accent)] text-slate-900"
                    : "border-transparent text-slate-500 hover:border-[var(--hub-border-strong)] hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
      </div>
    </nav>
  );
}
