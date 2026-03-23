"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  Building2,
  GitBranch,
  ClipboardList,
  FolderKanban,
  Activity,
  Settings,
  Sun,
  Moon,
} from "lucide-react";

const tabs = [
  { href: "/", label: "Office", icon: Building2, exact: true },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/org-chart", label: "Org Chart", icon: GitBranch },
];

const navLinks = [
  { href: "/monitor", label: "Monitor", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function OfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <div className="flex items-center border-b px-4 gap-1 shrink-0">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 pr-4">
          <Image src="/icon.png" alt="TinyAGI" width={20} height={20} className="h-5 w-5" />
          <span className="text-sm font-bold tracking-tight">TinyAGI</span>
        </Link>

        {/* Tabs */}
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Nav links */}
        {navLinks.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-1.5 px-2.5 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="ml-1 p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
