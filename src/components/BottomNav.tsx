"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BudgetIcon, HomeIcon, ListIcon, PlusIcon, SettingsIcon } from "./icons";
import { cx } from "./ui";

const TABS = [
  { href: "/", label: "Overview", Icon: HomeIcon },
  { href: "/activity", label: "Activity", Icon: ListIcon },
  null, // the + button
  { href: "/budgets", label: "Budgets", Icon: BudgetIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function BottomNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <nav className="grid shrink-0 grid-cols-5 items-center border-t border-nav-line bg-surface px-3 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] min-h-[84px] box-border">
      {TABS.map((tab) =>
        tab ? (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active(tab.href) ? "page" : undefined}
            className={cx(
              "flex min-h-11 justify-center flex-col items-center gap-[3px] rounded-xl text-[11px]",
              active(tab.href) ? "font-semibold text-accent-link" : "text-muted",
            )}
          >
            <tab.Icon />
            {tab.label}
          </Link>
        ) : (
          <Link
            key="add"
            href="/add"
            aria-label="Add a transaction"
            className="flex size-[52px] items-center justify-center justify-self-center rounded-full bg-accent text-white shadow-[0_4px_12px_var(--color-shadow)] hover:text-white hover:bg-accent-link"
          >
            <PlusIcon />
          </Link>
        ),
      )}
    </nav>
  );
}
