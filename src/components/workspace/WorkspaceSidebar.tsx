"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getChatGroups } from "@/lib/chat-ui";

type Chat = {
  id: string;
  title: string;
  source?: "WEB" | "TELEGRAM";
  pinned?: boolean;
  updatedAt: string;
};

type WorkspaceSidebarProps = {
  activeTool: "text" | "images";
  user?: {
    email?: string | null;
    role?: string | null;
    planName?: string | null;
    displayName?: string | null;
  };
};

export default function WorkspaceSidebar({ activeTool, user }: WorkspaceSidebarProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function loadChats() {
      try {
        const response = await fetch("/api/chats", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        setChats((payload?.data ?? []) as Chat[]);
      } catch {
        // Sidebar must never block the current tool.
      }
    }

    void loadChats();
  }, []);

  const visibleChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? chats.filter((chat) => chat.title.toLowerCase().includes(query))
      : chats;
    return [...filtered].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [chats, searchQuery]);

  const chatGroups = useMemo(() => getChatGroups(visibleChats), [visibleChats]);

  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col glass-panel md:flex">
      <div className="p-5 pb-3">
        <Link href="/" className="block cursor-pointer">
          <h1 className="text-xl font-bold tracking-tight text-text-primary">
            Platforma<span className="text-primary">AI</span>
          </h1>
          <p className="text-xs text-text-secondary">Единый агрегатор LLM</p>
        </Link>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Link
            href="/"
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
              activeTool === "text"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-black/10 bg-white/60 text-text-secondary hover:bg-white hover:text-text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">article</span>
            Текст
          </Link>
          <Link
            href="/images"
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${
              activeTool === "images"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-black/10 bg-white/60 text-text-secondary hover:bg-white hover:text-text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">imagesmode</span>
            Фото
          </Link>
        </div>

        <Link
          href="/"
          className="mt-4 flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-[0_14px_28px_rgba(212,122,106,0.22)] transition-colors hover:bg-primary/90"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          Новый чат
        </Link>

        <div className="relative mt-4">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-secondary">
            search
          </span>
          <input
            className="h-10 w-full rounded-xl border border-black/10 bg-white/70 pl-9 pr-3 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            placeholder="Поиск по чатам"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">
          Чаты
        </p>
        <div className="space-y-2">
          {chatGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              {group.items.map((chat) => (
                <Link
                  key={chat.id}
                  href={`/?chatId=${chat.id}`}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-black/5"
                >
                  <span className="material-symbols-outlined text-[19px] text-text-secondary transition-colors group-hover:text-primary">
                    {chat.source === "TELEGRAM" ? "send" : "chat_bubble"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                    {chat.title}
                  </span>
                </Link>
              ))}
            </div>
          ))}
          {!visibleChats.length && (
            <div className="rounded-xl border border-dashed border-black/10 px-3 py-6 text-center text-xs text-text-secondary">
              Чатов пока нет.
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-black/10 p-4">
        <Link
          href="/settings"
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/10 bg-black/5 px-3 py-2.5 transition-colors hover:bg-white"
        >
          <div className="flex size-9 items-center justify-center rounded-full bg-white text-sm font-bold text-text-secondary">
            {(user?.displayName || user?.email || "U")[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">
              {user?.displayName || user?.email || "Пользователь"}
            </p>
            <p className="truncate text-xs text-text-secondary">
              {user?.planName || "Free"}
            </p>
          </div>
          <span className="material-symbols-outlined text-[18px] text-text-secondary">
            settings
          </span>
        </Link>
      </div>
    </aside>
  );
}
