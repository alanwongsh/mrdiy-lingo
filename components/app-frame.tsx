"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SidebarNav } from "@/components/sidebar-nav";

type NavItem = { href: string; label: string; hint?: string };

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
  onNavigate,
}: {
  nav: NavItem[];
  appLinks: NavItem[];
  actor: { name: string; username: string };
  isSuperadmin: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="relative border-b border-black/10 px-4 py-5">
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
            className="mx-auto h-auto w-14 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
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
        <div>
          <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-[var(--hub-sidebar-muted)] uppercase">
            Navigate
          </div>
          <SidebarNav items={nav} onNavigate={onNavigate} />
        </div>
        {appLinks.length > 0 ? (
          <div>
            <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-[var(--hub-sidebar-muted)] uppercase">
              Apps
            </div>
            <SidebarNav items={appLinks} onNavigate={onNavigate} />
          </div>
        ) : null}
      </nav>
      <div className="border-t border-black/10 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[11px] text-[var(--hub-sidebar-muted)]">
        <div className="mb-2">
          <div className="text-sm font-semibold text-[var(--hub-sidebar-fg)]">{actor.name}</div>
          <div className="mt-0.5 break-all">{actor.username}</div>
          {isSuperadmin ? (
            <div className="mt-0.5 font-semibold text-[var(--diy-red)]">Superadmin</div>
          ) : null}
          <Link
            href="/embed/sign-out"
            className="hub-text-button mt-1 inline-block text-xs"
            onClick={onNavigate}
          >
            Sign out
          </Link>
        </div>
        Mr DIY Lingo · V1
      </div>
    </>
  );
}

export function AppFrame({
  nav,
  appLinks,
  actor,
  isSuperadmin,
  children,
}: {
  nav: NavItem[];
  appLinks: NavItem[];
  actor: { name: string; username: string };
  isSuperadmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex min-h-dvh text-[var(--hub-fg)]">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-[var(--hub-sidebar)] text-[var(--hub-sidebar-fg)] shadow-[4px_0_24px_rgba(28,20,8,0.12)] lg:flex">
        <SidebarBody
          nav={nav}
          appLinks={appLinks}
          actor={actor}
          isSuperadmin={isSuperadmin}
        />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside
            id="mobile-nav"
            className="relative flex h-dvh w-[min(18rem,88vw)] flex-col bg-[var(--hub-sidebar)] text-[var(--hub-sidebar-fg)] shadow-[8px_0_32px_rgba(28,20,8,0.2)]"
          >
            <button
              type="button"
              className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--hub-sidebar-fg)] hover:bg-[var(--hub-sidebar-hover)]"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <CloseIcon />
            </button>
            <SidebarBody
              nav={nav}
              appLinks={appLinks}
              actor={actor}
              isSuperadmin={isSuperadmin}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-black/10 bg-[var(--hub-sidebar)] text-[var(--hub-sidebar-fg)] pt-[env(safe-area-inset-top)] lg:hidden">
          <div className="flex items-center gap-2 px-2 py-2">
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--hub-sidebar-hover)]"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label="Open menu"
              onClick={() => setOpen(true)}
            >
              <MenuIcon />
            </button>
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
