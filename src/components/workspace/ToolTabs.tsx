"use client";

import Link from "next/link";

type Tool = {
  id: "text" | "images";
  label: string;
  icon: string;
  href: string;
};

const tools: Tool[] = [
  { id: "text", label: "Текст", icon: "article", href: "/" },
  { id: "images", label: "Изображения", icon: "imagesmode", href: "/images" },
];

export default function ToolTabs({ active }: { active: Tool["id"] }) {
  return (
    <nav
      className="inline-flex rounded-2xl border border-black/10 bg-black/5 p-1 shadow-sm backdrop-blur"
      aria-label="Инструменты"
    >
      {tools.map((tool) => {
        const isActive = tool.id === active;
        return (
          <Link
            key={tool.id}
            href={tool.href}
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${
              isActive
                ? "bg-white text-primary shadow-sm"
                : "text-text-secondary hover:bg-white/70 hover:text-text-primary"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {tool.icon}
            </span>
            <span>{tool.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
