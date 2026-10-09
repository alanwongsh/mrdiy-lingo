"use client";

import Image from "next/image";
import Link from "next/link";
import { SidebarNav } from "@/components/sidebar-nav";

type NavItem = {
  href: string;
  label: string;
  hint?: string;
  match?: string;
  badge?: number;
};

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SidebarBody({
  nav,
  appLinks,
  actor,
  isSuperadmin,
  embedded,
  onNavigate,
}: {
  nav: NavItem[];
  appLinks: NavItem[];
  actor: { name: string; username: string };
  isSuperadmin: boolean;
  embedded?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="relative border-b border-[var(--hub-border)] px-4 py-5">
        <div className="absolute inset-x-0 top-0 h-1 bg-[var(--diy-red)]" />
        <Link href="/" className="block text-center" onClick={onNavigate}>
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
            className="mx-auto h-auto w-14 drop-shadow-[0_2px_8px_rgba(28,20,8,0.12)]"
          />
          <div className="mt-2 text-lg font-bold tracking-tight text-[var(--hub-sidebar-fg)]">
            Lingo
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--hub-sidebar-muted)]">
            Translation hub
          </div>
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-7 overflow-y-auto px-3 py-4">
        {isSuperadmin ? (
          <div>
            <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-[var(--hub-sidebar-muted)] uppercase">
              Navigate
            </div>
            <SidebarNav items={nav} onNavigate={onNavigate} />
          </div>
        ) : null}
        {appLinks.length > 0 ? (
          <div>
            <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-[var(--hub-sidebar-muted)] uppercase">
              Apps
            </div>
            <SidebarNav items={appLinks} onNavigate={onNavigate} />
          </div>
        ) : null}
      </nav>
      <div className="border-t border-[var(--hub-border)] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[11px] text-[var(--hub-sidebar-muted)]">
        {embedded ? null : (
          <div className="mb-2">
            <div className="text-sm font-semibold text-[var(--hub-sidebar-fg)]">{actor.name}</div>
            <div className="mt-0.5 break-all">{actor.username}</div>
            {isSuperadmin ? (
              <div className="mt-0.5 font-semibold text-[var(--diy-red)]">Superadmin</div>
            ) : null}
            <form action="/embed/sign-out" method="post" className="mt-1">
              <button
                type="submit"
                className="hub-text-button text-xs"
                onClick={onNavigate}
              >
                Sign out
              </button>
            </form>
          </div>
        )}
        Mr DIY Lingo · V1
      </div>
    </>
  );
}

function closeMobileNav() {
  const nav = document.getElementById("mobile-nav");
  if (nav instanceof HTMLDetailsElement) nav.open = false;
}

export function AppFrame({
  nav,
  appLinks,
  actor,
  isSuperadmin,
  embedded,
  children,
}: {
  nav: NavItem[];
  appLinks: NavItem[];
  actor: { name: string; username: string };
  isSuperadmin: boolean;
  embedded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh text-[var(--hub-fg)]">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-[var(--hub-border)] bg-[var(--hub-sidebar)] text-[var(--hub-sidebar-fg)] lg:flex">
        <SidebarBody
          nav={nav}
          appLinks={appLinks}
          actor={actor}
          isSuperadmin={isSuperadmin}
          embedded={embedded}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-50 border-b border-[var(--hub-border)] bg-[var(--hub-sidebar)] pt-[env(safe-area-inset-top)] text-[var(--hub-sidebar-fg)] lg:hidden">
          <div className="flex items-center gap-2 px-2 py-2">
            <details id="mobile-nav" className="group">
              <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg [&::-webkit-details-marker]:hidden hover:bg-[var(--hub-sidebar-hover)]">
                <span className="group-open:hidden">
                  <MenuIcon />
                </span>
                <span className="hidden group-open:inline">
                  <CloseIcon />
                </span>
                <span className="sr-only">Menu</span>
              </summary>
              <div className="fixed inset-x-0 bottom-0 z-40 top-[calc(env(safe-area-inset-top)+4.25rem)]">
                <button
                  type="button"
                  className="absolute inset-0 bg-black/40"
                  aria-label="Close menu"
                  onClick={closeMobileNav}
                />
                <aside className="relative flex h-full w-[min(18rem,88vw)] flex-col overflow-hidden border-r border-[var(--hub-border)] bg-[var(--hub-sidebar)] text-[var(--hub-sidebar-fg)]">
                  <SidebarBody
                    nav={nav}
                              appLinks={appLinks}
                    actor={actor}
                    isSuperadmin={isSuperadmin}
                    embedded={embedded}
                    onNavigate={closeMobileNav}
                  />
                </aside>
              </div>
            </details>
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <Image
                src="/brand/mr-diy-logo.png"
                alt=""
                width={40}
                height={36}
                className="h-auto w-8"
              />
              <span className="truncate text-base font-bold tracking-tight">Lingo</span>
            </Link>
          </div>
        </header>
        <main className="hub-main min-w-0 flex-1 text-[var(--hub-fg)]">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
