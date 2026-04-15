"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavItems } from "@/lib/navigation";

type UserMenuProps = {
  email?: string | null;
  displayName?: string | null;
  planName?: string | null;
  role?: string | null;
  onNavigate?: () => void;
};

function resolveInitial(value: string | null | undefined) {
  if (!value) return "U";
  return value.trim().charAt(0).toUpperCase() || "U";
}

export default function UserMenu({
  email,
  displayName,
  planName,
  role,
  onNavigate,
}: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(event: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const name = displayName?.trim() || email?.trim() || "Пользователь";
  const plan = planName?.trim() || "Тариф не назначен";
  const initial = resolveInitial(email ?? displayName);
  const navItems = getNavItems(role, email);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-expanded={isOpen}
        aria-controls="user-menu"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-border-light">
          {initial}
        </div>
        <div className="flex-1 overflow-hidden text-left">
          <p className="truncate text-sm font-medium text-text-main">{name}</p>
          <p className="truncate text-xs text-text-secondary">{plan}</p>
        </div>
        <span className="material-symbols-outlined text-[18px] text-gray-400 group-hover:text-gray-600">
          expand_more
        </span>
      </button>
      {isOpen && (
        <div
          id="user-menu"
          className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-white/60 bg-white/95 p-2 shadow-glass-lg backdrop-blur-md"
        >
          <div className="px-2 pb-2 text-xs text-text-secondary">
            Разделы платформы
          </div>
          {navItems.map((item) => {
            const active = pathname
              ? item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href)
              : false;
            return (
              <Link
                key={item.href}
                className={`mb-1 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-gray-700 hover:bg-white"
                }`}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setIsOpen(false);
                  onNavigate?.();
                }}
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
      )}
    </div>
  );
}
