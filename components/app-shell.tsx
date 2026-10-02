import Image from "next/image";
import Link from "next/link";
import { listApplications } from "@/lib/actions/applications";
import { SidebarNav } from "@/components/sidebar-nav";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/applications", label: "Applications" },
  { href: "/languages", label: "Languages" },
  { href: "/import", label: "Import" },
  { href: "/setup", label: "Setup" },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  try {
    apps = await listApplications({ includeInactive: true });
  } catch {
    apps = [];
  }

  const appLinks = apps.map((app) => ({
    href: `/applications/${app.id}`,
    label: app.name,
    hint: app.model_type === "STRING" ? "Strings" : "Content",
  }));

  return (
    <div className="flex min-h-dvh text-[var(--hub-fg)]">
      <aside className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col bg-[var(--hub-sidebar)] text-[var(--hub-sidebar-fg)] shadow-[4px_0_24px_rgba(227,6,19,0.18)]">
        <div className="relative border-b border-white/10 px-4 py-5">
          <div className="absolute inset-x-0 top-0 h-1 bg-[var(--diy-yellow)]" />
          <Link href="/" className="block text-center">
            {/*
              Brand lockup: circular master logo alone carries MR.DIY + tagline.
              Product name "Lingo" sits under it — do not restack "MR.DIY" text
              or the retail slogan as separate wording.
            */}
            <Image
              src="/brand/mr-diy-logo.png"
              alt="MR.DIY"
              width={88}
              height={80}
              priority
              className="mx-auto h-auto w-14 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
            />
            <div className="mt-2 text-lg font-bold tracking-tight text-white">
              Lingo
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              Translation hub
            </div>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-7 overflow-y-auto px-3 py-4">
          <div>
            <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-[var(--hub-sidebar-muted)] uppercase">
              Navigate
            </div>
            <SidebarNav items={nav} />
          </div>
          {appLinks.length > 0 ? (
            <div>
              <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-[var(--hub-sidebar-muted)] uppercase">
                Apps
              </div>
              <SidebarNav items={appLinks} />
            </div>
          ) : null}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-[11px] text-[var(--hub-sidebar-muted)]">
          Mr DIY Lingo · V1
        </div>
      </aside>
      <main className="hub-main min-h-dvh flex-1 overflow-auto text-[var(--hub-fg)]">
        <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8">{children}</div>
      </main>
    </div>
  );
}
