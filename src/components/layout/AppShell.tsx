"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import UserMenu from "@/components/layout/UserMenu";

export type ShellUser = {
  email?: string | null;
  role?: string | null;
  planName?: string | null;
  displayName?: string | null;
};

type AppShellProps = {
  title: string;
  subtitle?: string;
  user?: ShellUser;
  actions?: ReactNode;
  showSidebar?: boolean;
  children: ReactNode;
};

export default function AppShell({
  title,
  subtitle,
  user,
  actions,
  showSidebar = true,
  children,
}: AppShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const asideContent = (
    <>
      <div className="p-3 pb-2">
        <Link
          className="group flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white/90 px-3 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-white hover:text-gray-900 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          href="/"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <span className="material-symbols-outlined text-[20px] text-gray-500 group-hover:text-primary transition-colors">
            add
          </span>
          <span className="flex-1 text-left">Создать чат</span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-xs text-text-secondary">
        <div className="rounded-lg border border-gray-200 bg-white/88 px-3 py-3">
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
      </div>
      <div className="border-t border-white/30 p-3">
        <UserMenu
          email={user?.email}
          displayName={user?.displayName}
          planName={user?.planName}
          role={user?.role}
          onNavigate={() => setIsMobileMenuOpen(false)}
        />
      </div>
    </>
  );

  return (
    <div className="text-text-main h-screen flex overflow-hidden bg-[#f0f0f5]">
      {showSidebar && isMobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          aria-label="Закрыть меню"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {showSidebar && (
        <>
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
        </>
      )}

      <main className="relative m-4 flex h-full flex-1 flex-col overflow-hidden rounded-xl glass-panel shadow-glass-lg">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-xl bg-white/82 px-4 py-3 backdrop-blur-md">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {showSidebar && (
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white/80 text-gray-700 md:hidden"
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label="Открыть меню"
              >
                <span className="material-symbols-outlined text-[20px]">menu</span>
              </button>
            )}
            <h1 className="truncate text-lg font-semibold text-text-main sm:text-xl font-display">
              <span className="block">{title}</span>
              {subtitle && (
                <span className="block text-xs font-normal text-text-secondary sm:text-sm">
                  {subtitle}
                </span>
              )}
            </h1>
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
