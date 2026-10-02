"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BookOpen, Compass, Library, Settings, Upload, Headphones } from "lucide-react";

const NAV = [
  { href: "/", label: "Home", icon: Headphones },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/library", label: "My audiobooks", icon: Library },
  { href: "/upload", label: "Upload", icon: Upload },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const isPlayer = /^\/books\/[^/]+\/(listen|read)/.test(path);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col px-4 sm:px-6 lg:px-10">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="VoxLibris home">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent text-white shadow-[0_8px_20px_-8px_rgb(242_107_58/0.8)]"><BookOpen size={20} aria-hidden /></span>
          <span className="font-display text-xl font-semibold tracking-tight">VoxLibris</span>
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={`relative rounded-full px-4 py-2 text-sm font-medium transition hover:bg-card ${active(n.href) ? "text-ink" : "text-ink-soft"}`}>
              {n.label}
              {active(n.href) && <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" aria-hidden />}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/upload" className="btn-primary hidden md:inline-flex"><Upload size={16} aria-hidden /> Upload a book</Link>
          <Link href="/settings" aria-label="Settings" className="grid h-10 w-10 place-items-center rounded-full bg-card text-ink-soft shadow-soft hover:text-ink"><Settings size={18} aria-hidden /></Link>
        </div>
      </header>
      <main id="main" className={`flex-1 ${isPlayer ? "pb-6" : "pb-28 md:pb-12"}`}>{children}</main>
      {!isPlayer && (
        <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <ul className="grid grid-cols-4">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} aria-current={active(n.href) ? "page" : undefined} className={`flex flex-col items-center gap-1 py-3 text-[11px] font-medium ${active(n.href) ? "text-accent" : "text-ink-mute"}`}>
                  <n.icon size={20} aria-hidden />
                  {n.label === "My audiobooks" ? "Library" : n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
