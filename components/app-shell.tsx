import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { listApplications } from "@/lib/actions/applications";
import { countArticlesNeedingReview } from "@/lib/actions/press";
import { canOpenSetup, getCurrentUser } from "@/lib/auth/access";
import { getActor } from "@/lib/auth/actor";
import { AppFrame } from "@/components/app-frame";
import { isProduction } from "@/lib/env";
import type { SidebarApp } from "@/lib/app-sections";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  const headerStore = await headers();
  const embedded =
    headerStore.get("x-lingo-embed") === "1" ||
    new URLSearchParams(headerStore.get("x-lingo-search") ?? "").get("embed") ===
      "true";
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  let setupOpen = true;
  try {
    setupOpen = await canOpenSetup();
  } catch {
    setupOpen = true;
  }
  if (actor) {
    try {
      user = await getCurrentUser();
    } catch {
      user = null;
    }
  }

  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  if (user) {
    try {
      apps = await listApplications({ includeInactive: true });
    } catch {
      apps = [];
    }
  }

  const nav = [
    { href: "/", label: "Dashboard" },
    { href: "/applications", label: "Applications" },
    { href: "/import", label: "Import" },
  ];
  if (user?.is_superadmin) {
    nav.push({ href: "/roles", label: "Default roles" });
    nav.push({ href: "/job-titles", label: "Job titles" });
    nav.push({ href: "/languages", label: "Languages" });
    nav.push({ href: "/email-templates", label: "Email templates" });
    nav.push({ href: "/logs", label: "Logs" });
  }
  if (setupOpen) {
    nav.push({ href: "/setup", label: "Setup" });
  }

  let reviewCounts: Record<string, number> = {};
  // Only approvers get the count: they are the ones it asks to act.
  const contentAppIds = apps
    .filter((app) => app.model_type === "CONTENT" && app.access.can_approve)
    .map((app) => app.id);
  if (contentAppIds.length > 0) {
    try {
      reviewCounts = await countArticlesNeedingReview(contentAppIds);
    } catch {
      reviewCounts = {};
    }
  }

  // Only what the sidebar needs; the switcher and the app menu are built from this.
  const sidebarApps: SidebarApp[] = apps.map((app) => ({
    id: app.id,
    name: app.name,
    model_type: app.model_type,
    item_label: app.item_label,
    status: app.status,
    access: {
      permissions: app.access.permissions,
      can_manage: app.access.can_manage,
      can_approve: app.access.can_approve,
      role: app.access.role,
      is_owner: app.access.is_owner,
      unit_names: app.access.unit_names,
      markets: app.access.markets,
    },
    reviewCount: app.model_type === "CONTENT" ? reviewCounts[app.id] ?? 0 : 0,
  }));

  if (!actor) {
    redirect("/sign-in");
  }

  return (
    <AppFrame
      nav={nav}
      apps={sidebarApps}
      publishing={!isProduction()}
      actor={{ name: actor.name, username: actor.username }}
      isSuperadmin={!!user?.is_superadmin}
      embedded={embedded}
    >
      {children}
    </AppFrame>
  );
}
