import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { listApplications } from "@/lib/actions/applications";
import { countArticlesNeedingReview } from "@/lib/actions/press";
import { canOpenSetup, getCurrentUser } from "@/lib/auth/access";
import { getActor } from "@/lib/auth/actor";
import { AppFrame } from "@/components/app-frame";
import { appHomePath, appKindLabel } from "@/lib/catalog";

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

  const appLinks = apps.map((app) => {
    const reviewCount =
      app.model_type === "CONTENT" ? reviewCounts[app.id] ?? 0 : 0;
    return {
      href: appHomePath(app),
      match: `/applications/${app.id}`,
      label: app.name,
      hint:
        reviewCount > 0
          ? reviewCount === 1
            ? "1 needs review"
            : `${reviewCount} need review`
          : appKindLabel(app),
      badge: reviewCount > 0 ? reviewCount : undefined,
      badgeHref: `/applications/${app.id}/articles?status=REVIEW`,
      badgeLabel: `Show the ${reviewCount} ${reviewCount === 1 ? "article" : "articles"} in review`,
    };
  });

  if (!actor) {
    redirect("/sign-in");
  }

  return (
    <AppFrame
      nav={nav}
      appLinks={appLinks}
      actor={{ name: actor.name, username: actor.username }}
      isSuperadmin={!!user?.is_superadmin}
      embedded={embedded}
    >
      {children}
    </AppFrame>
  );
}
