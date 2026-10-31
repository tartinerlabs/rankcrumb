import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getSidebarApps, getSidebarBrainstorms } from "./data/apps";
import { AppShell } from "./app-shell";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "RankCrumb", template: "%s · RankCrumb" },
  description:
    "Personal App Store keyword tracker: rank, demand and competition per storefront.",
};

// HeroUI switches themes with data-theme on <html>; follow the system setting
// before first paint and whenever it changes
const themeScript = `(function(){var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){document.documentElement.setAttribute("data-theme",m.matches?"dark":"light")}a();m.addEventListener("change",a)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static theme script, no user input
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="bg-background font-sans text-foreground">
        {/* Not awaited: the sidebar streams its lists in Suspense boundaries */}
        <AppShell apps={getSidebarApps()} brainstorms={getSidebarBrainstorms()}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
