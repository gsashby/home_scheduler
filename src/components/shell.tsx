"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFamily } from "@/lib/family-context";
import { NotificationsBell } from "@/components/notifications-bell";
import { Swatch } from "@/components/ui";

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, isParent, family } = useFamily();
  const pathname = usePathname();

  const tabs = [
    { href: "/", label: "Today" },
    { href: "/calendar", label: "Calendar" },
    { href: "/tasks", label: "Tasks" },
    ...(isParent ? [{ href: "/zones", label: "Zones" }] : []),
    { href: "/jobs", label: "Job Board" },
    ...(isParent ? [{ href: "/settings", label: "Settings" }] : []),
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-gray-50/90 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight">
            <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-indigo-600" />
            Home Scheduler
          </span>
          <span
            className="hidden items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 sm:flex"
            title="Private to your family — no other family can see or access this data."
          >
            {family.name}
            <span className="text-gray-400">·</span>
            🔒 Private to your family
          </span>
          <div className="flex-1" />
          <span className="flex items-center gap-1.5 text-sm text-gray-600">
            <Swatch color={me.color} />
            {me.display_name}
          </span>
          <NotificationsBell />
        </div>
        <nav className="-mb-px flex gap-1 overflow-x-auto pt-2">
          {tabs.map((tab) => {
            const active =
              tab.href === "/"
                ? pathname === "/"
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-t-lg border border-b-0 px-3.5 py-2 text-[13.5px] font-semibold whitespace-nowrap ${
                  active
                    ? "border-gray-200 bg-white text-gray-900"
                    : "border-transparent text-gray-600 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex flex-1 flex-col p-4 pb-10">{children}</main>
    </div>
  );
}
