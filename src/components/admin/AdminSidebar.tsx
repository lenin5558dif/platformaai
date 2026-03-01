"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin", label: "Главная", icon: "dashboard" },
  { href: "/admin/clients", label: "Клиенты", icon: "group" },
  { href: "/admin/api-routing", label: "API маршрутизация", icon: "hub" },
  { href: "/admin/billing", label: "Финансы", icon: "payments" },
  { href: "/admin/monitoring", label: "Мониторинг", icon: "monitoring" },
  { href: "/admin/events", label: "События", icon: "history" },
  { href: "/admin/audit", label: "Аудит", icon: "policy" },
];

export default function AdminSidebar(props: { userEmail?: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="w-full md:w-72 md:min-h-screen border-r border-white/50 bg-white/70 backdrop-blur-sm">
      <div className="px-4 py-5 border-b border-white/60">
        <h1 className="text-lg font-semibold text-text-main font-display">Admin Panel</h1>
        <p className="mt-1 text-xs text-text-secondary truncate">
          {props.userEmail ?? "admin"}
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
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
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
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-main hover:bg-white"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Вернуться в чаты</span>
        </Link>
      </div>
    </aside>
  );
}
