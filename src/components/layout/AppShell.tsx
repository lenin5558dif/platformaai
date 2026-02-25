"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import UserMenu from "@/components/layout/UserMenu";
import { getNavItems } from "@/lib/navigation";

export type ShellUser = {
  email?: string | null;
  role?: string | null;
  planName?: string | null;
  displayName?: string | null;
};

function getUserInitial(displayName?: string | null, email?: string | null) {
  const value = (displayName ?? email ?? "").trim();
  return value.charAt(0).toUpperCase() || "U";
}

type AppShellProps = {
  title: string;
  subtitle?: string;
  user?: ShellUser;
  actions?: ReactNode;
  showPlatformNav?: boolean;
  children: ReactNode;
};

export default function AppShell({
  title,
  subtitle,
  user,
  actions,
  showPlatformNav = false,
  children,
}: AppShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const navItems = showPlatformNav ? getNavItems(user?.role) : [];
  const userName =
    user?.displayName?.trim() || user?.email?.trim() || "Пользователь";
  const userPlan = user?.planName?.trim() || "Pro Plan";
  const userInitial = getUserInitial(user?.displayName, user?.email);

  const asideContent = (
    <>
      {!showPlatformNav && (
        <div className="p-3 pb-2">
          <Link
            className="group flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white/70 px-3 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-white hover:text-gray-900 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            href="/"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-primary transition-colors">
              add
            </span>
            <span className="flex-1 text-left">Создать чат</span>
          </Link>
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-2 text-xs text-text-secondary">
        {showPlatformNav && (
          <nav className="rounded-xl border border-white/60 bg-white/70 p-3">
            <p className="px-1 pb-2 text-xs text-text-secondary">
              Разделы платформы
            </p>
            <div className="space-y-1">
              {navItems.map((item) => {
                const active = pathname
                  ? item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href)
                  : false;

                return (
                  <Link
                    key={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-gray-700 hover:bg-white/80"
                    }`}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <span
                      className={`material-symbols-outlined text-[20px] ${
                        active ? "text-primary" : "text-gray-500"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        )}
        {!showPlatformNav && (
          <div className="rounded-lg border border-white/60 bg-white/60 px-3 py-3">
            <p className="font-medium text-text-main">Быстрый доступ</p>
            <p className="mt-1 text-[11px] text-text-secondary">
              Возвращайтесь в чат и проверяйте ответы без лишних шагов.
            </p>
            <Link
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-hover"
              href="/"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Открыть чат
              <span className="material-symbols-outlined text-[14px]">
                arrow_right_alt
              </span>
            </Link>
          </div>
        )}
      </div>
      <div className="border-t border-white/30 p-3">
        {showPlatformNav ? (
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-border-light">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-text-main">{userName}</p>
              <p className="truncate text-xs text-text-secondary">{userPlan}</p>
            </div>
          </div>
        ) : (
          <UserMenu
            email={user?.email}
            displayName={user?.displayName}
            planName={user?.planName}
            role={user?.role}
            onNavigate={() => setIsMobileMenuOpen(false)}
          />
        )}
      </div>
    </>
  );

  return (
    <div className="text-text-main h-screen flex overflow-hidden bg-[#f0f0f5]">
      {isMobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          aria-label="Закрыть меню"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <aside className="hidden md:flex w-[280px] flex-col flex-shrink-0 z-20 transition-all duration-300 m-4 rounded-xl glass-panel shadow-glass-lg">
        {asideContent}
      </aside>

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col rounded-xl glass-panel shadow-glass-lg m-4 transition-transform duration-300 md:hidden ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-[120%]"
        }`}
      >
        {asideContent}
      </aside>

      <main className="flex-1 flex flex-col h-full relative m-4 rounded-xl glass-panel shadow-glass-lg overflow-hidden">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-white/50 px-4 py-3 backdrop-blur-sm rounded-t-xl">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <button
              type="button"
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white/80 text-gray-700"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Открыть меню"
            >
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              <h1 className="truncate text-lg font-semibold text-text-main sm:text-xl font-display">
                {title}
              </h1>
              {subtitle && (
                <p className="text-xs text-text-secondary sm:text-sm">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              className="rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-xs font-semibold text-gray-700 transition-colors hover:bg-white"
              href="/"
            >
              В чат
            </Link>
            {actions}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
