import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${hubSans.variable} ${hubMono.variable} h-full antialiased`}
    >
      <body className="min-h-dvh">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
