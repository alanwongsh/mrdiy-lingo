import Image from "next/image";
import Link from "next/link";
import { listApplications } from "@/lib/actions/applications";
import { getActor } from "@/lib/auth/actor";
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
  const actor = await getActor();
  const allowDevSignIn = process.env.EMBED_ALLOW_DEV === "true";

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
        <div className="border-t border-white/10 px-4 py-4 text-[11px] text-[var(--hub-sidebar-muted)]">
          {actor ? (
            <div className="mb-2">
              <div className="text-sm font-semibold text-white">{actor.name}</div>
              <div className="mt-0.5">{actor.username}</div>
              <Link href="/embed/sign-out" className="mt-1 inline-block text-[var(--diy-yellow)]">
                Sign out
              </Link>
            </div>
          ) : allowDevSignIn ? (
            <form action="/embed/dev" method="post" className="mb-3 space-y-1.5">
              <div className="text-[10px] font-semibold tracking-[0.16em] uppercase">
                Dev sign-in
              </div>
              <input
                name="username"
                required
                placeholder="username"
                className="h-8 w-full rounded-md border border-white/15 bg-white/10 px-2 text-xs text-white placeholder:text-slate-400"
              />
              <input
                name="name"
                placeholder="Display name"
                className="h-8 w-full rounded-md border border-white/15 bg-white/10 px-2 text-xs text-white placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="h-8 w-full rounded-md bg-[var(--diy-yellow)] text-xs font-semibold text-slate-900"
              >
                Sign in
              </button>
            </form>
          ) : (
            <div className="mb-2 text-slate-300">Not signed in</div>
          )}
          Mr DIY Lingo · V1
        </div>
      </aside>
      <main className="hub-main min-h-dvh flex-1 overflow-auto text-[var(--hub-fg)]">
        <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8">{children}</div>
      </main>
    </div>
  );
}
