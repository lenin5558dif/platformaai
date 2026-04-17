"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin", label: "Сводка", icon: "dashboard" },
  { href: "/admin/clients", label: "Клиенты", icon: "group" },
  { href: "/admin/billing", label: "Биллинг", icon: "payments" },
  { href: "/admin/feedback", label: "Обратная связь", icon: "chat" },
];

export default function AdminSidebar(props: { userEmail?: string | null }) {
  const pathname = usePathname();
  const navLinkClass =
    "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer";

  return (
    <aside className="w-full border-b border-white/50 bg-white/70 backdrop-blur-sm md:min-h-screen md:w-72 md:border-b-0 md:border-r">
      <div className="border-b border-white/60 px-4 py-4 md:py-5">
        <div className="flex items-start justify-between gap-3 md:block">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-semibold text-text-main">
              Админка
            </h1>
            <p className="mt-1 truncate text-xs text-text-secondary">
              {props.userEmail ?? "admin"}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-text-secondary">
              Minimal prod
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-sm text-text-main transition-colors motion-safe:duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Чаты</span>
          </Link>
        </div>
      </div>
      <nav className="overflow-x-auto p-3 md:space-y-1 md:overflow-visible">
        <div className="flex gap-2 md:block">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${navLinkClass} min-w-max shrink-0 md:min-w-0 ${
                  active
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-text-main hover:bg-white"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="hidden px-3 pb-4 md:block">
        <Link
          href="/"
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-main transition-colors motion-safe:duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Вернуться в чаты</span>
        </Link>
      </div>
    </aside>
  );
}
