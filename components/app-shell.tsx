import { redirect } from "next/navigation";
import { listApplications } from "@/lib/actions/applications";
import { canOpenSetup, getCurrentUser } from "@/lib/auth/access";
import { getActor } from "@/lib/auth/actor";
import { AppFrame } from "@/components/app-frame";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
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
    nav.push({ href: "/languages", label: "Languages" });
  }
  if (setupOpen) {
    nav.push({ href: "/setup", label: "Setup" });
  }

  const appLinks = apps.map((app) => ({
    href: `/applications/${app.id}`,
    label: app.name,
    hint: app.model_type === "STRING" ? "Strings" : "Content",
  }));

  if (!actor) {
    redirect("/sign-in");
  }

  return (
    <AppFrame
      nav={nav}
      appLinks={appLinks}
      actor={{ name: actor.name, username: actor.username }}
      isSuperadmin={!!user?.is_superadmin}
    >
      {children}
    </AppFrame>
  );
}
