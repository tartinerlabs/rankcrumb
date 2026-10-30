"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Check" },
  { href: "/tracking", label: "Tracking" },
  { href: "/ideas", label: "Ideas" },
  { href: "/listing", label: "Listing" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-border">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-5xl gap-1 px-4 sm:px-6"
      >
        {links.map(({ href, label }) => {
          const current =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={`-mb-px flex min-h-10 items-center border-b-2 px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring ${current ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
