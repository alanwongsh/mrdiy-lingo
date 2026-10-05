import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getActor, safeNextPath } from "@/lib/auth/actor";
import "./globals.css";

const hubSans = IBM_Plex_Sans({
  variable: "--font-hub-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const hubMono = IBM_Plex_Mono({
  variable: "--font-hub-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Mr DIY Lingo",
  description: "MR.DIY translation and multilingual content hub",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const path = headerStore.get("x-lingo-path") ?? "";
  const search = headerStore.get("x-lingo-search") ?? "";
  const actor = await getActor();
  const setupWithoutSession = path === "/setup" && !actor;

  if (path === "/sign-in" && actor) {
    redirect("/");
  }
  if (path && path !== "/sign-in" && path !== "/setup" && !actor) {
    const next = safeNextPath(`${path}${search}`);
    redirect(next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`);
  }

  const bare = path === "/sign-in" || setupWithoutSession;

  return (
    <html
      lang="en"
      className={`${hubSans.variable} ${hubMono.variable} h-full antialiased`}
    >
      <body className="min-h-dvh">
        {bare ? children : <AppShell>{children}</AppShell>}
      </body>
    </html>
  );
}
