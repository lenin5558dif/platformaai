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
    <aside className="w-full md:w-72 md:min-h-screen border-r border-white/50 bg-white/70 backdrop-blur-sm">
      <div className="px-4 py-5 border-b border-white/60">
        <h1 className="text-lg font-semibold text-text-main font-display">Админка</h1>
        <p className="mt-1 text-xs text-text-secondary truncate">
          {props.userEmail ?? "admin"}
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-text-secondary">
          Minimal prod
        </p>
      </div>
      <nav className="p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${navLinkClass} ${
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
      </nav>
      <div className="px-3 pb-4">
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
