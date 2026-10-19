import { itemLabelPlural } from "@/lib/catalog";
import type { PermissionKey } from "@/lib/auth/permissions";
import type { AppAccess, Application } from "@/lib/types";

/** One link in the sidebar for the open application. */
export type SectionLink = {
  href: string;
  label: string;
  /** One short line under the label. */
  hint?: string;
  /** Active only on this exact path, not on pages under it. */
  exact?: boolean;
  /** Not active on paths under this one, such as Import under Items. */
  exclude?: string;
  badge?: number;
  badgeHref?: string;
  badgeLabel?: string;
};

export type SectionGroup = { label: string; links: SectionLink[] };

/** What the sidebar needs to know about an application. */
export type SidebarApp = Pick<Application, "id" | "name" | "model_type" | "item_label" | "status"> & {
  access: Pick<AppAccess, "permissions" | "can_manage" | "can_approve">;
  /** Articles in review in this person's markets. Only counted for approvers. */
  reviewCount: number;
};

function reviewBadge(app: SidebarApp): Pick<SectionLink, "badge" | "badgeHref" | "badgeLabel"> {
  if (app.reviewCount <= 0) return {};
  return {
    badge: app.reviewCount,
    badgeHref: `/applications/${app.id}/articles?status=REVIEW`,
    badgeLabel: `Show the ${app.reviewCount} ${app.reviewCount === 1 ? "article" : "articles"} in review`,
  };
}

/**
 * The open application's pages, grouped for the sidebar. Each person only gets the pages
 * their role allows; the pages themselves check again.
 */
export function appSections(app: SidebarApp, opts: { publishing: boolean }): SectionGroup[] {
  const base = `/applications/${app.id}`;
  const can = (key: PermissionKey) => app.access.permissions.includes(key);
  const canImport = can("content.import");
  const canManageRoles = can("roles.manage");
  const roles: SectionLink = {
    href: `${base}/settings/roles`,
    label: "Roles",
    hint: "What each role can do",
  };
  const people: SectionLink = {
    href: `${base}/settings/people`,
    label: "People",
    hint: "Who can open this app",
  };

  if (app.model_type === "STRING") {
    return [
      {
        label: "Work",
        links: [
          { href: base, label: "Overview", hint: "Progress at a glance", exact: true },
          { href: `${base}/translations`, label: "Translations", hint: "Strings in every language" },
          { href: `${base}/namespaces`, label: "Namespaces", hint: "Groups of strings" },
          ...(canImport ? [{ href: `${base}/import`, label: "Import", hint: "Upload Excel or CSV" }] : []),
        ],
      },
      ...(canManageRoles ? [{ label: "Settings", links: [roles] }] : []),
    ];
  }

  if (app.model_type === "CATALOG") {
    const settings = [...(app.access.can_manage ? [people] : []), ...(canManageRoles ? [roles] : [])];
    return [
      {
        label: "Work",
        links: [
          {
            href: `${base}/items`,
            label: itemLabelPlural(app),
            hint: "Write and translate",
            exclude: `${base}/items/import`,
          },
          ...(canImport
            ? [{ href: `${base}/items/import`, label: "Import", hint: "Upload Excel or CSV" }]
            : []),
          { href: `${base}/fields`, label: "Fields", hint: "What each item holds" },
        ],
      },
      ...(settings.length ? [{ label: "Settings", links: settings }] : []),
    ];
  }

  return [
    {
      label: "Work",
      links: [
        ...(can("content.edit")
          ? [{ href: `${base}/articles/new`, label: "New draft", hint: "Start a new article" }]
          : []),
        {
          href: `${base}/articles`,
          label: "Articles",
          hint: "Write, translate and review",
          // The new draft page has its own row.
          exclude: `${base}/articles/new`,
          ...reviewBadge(app),
        },
        ...(canImport ? [{ href: `${base}/import`, label: "Import", hint: "Upload Excel or CSV" }] : []),
      ],
    },
    {
      label: "Settings",
      links: [
        { href: `${base}/settings/general`, label: "General", hint: "Article types, review emails" },
        ...(app.access.can_manage ? [people] : []),
        ...(canManageRoles
          ? [
              roles,
              {
                href: `${base}/settings/business-units`,
                label: "Business units",
                hint: "Countries each team covers",
              },
            ]
          : []),
        {
          href: `${base}/settings/quality`,
          label: opts.publishing ? "Quality & publishing" : "Quality",
          hint: opts.publishing ? "Checks, glossary, providers" : "Checks, glossary, standard text",
        },
      ],
    },
  ];
}

/** Whether a sidebar link is the page being shown. */
export function isSectionActive(link: Pick<SectionLink, "href" | "exact" | "exclude">, pathname: string) {
  if (link.exclude && pathname.startsWith(link.exclude)) return false;
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/** The application id in a path such as /applications/{id}/articles, or null. */
export function appIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/applications\/([^/]+)/);
  if (!match || match[1] === "new") return null;
  return match[1];
}
