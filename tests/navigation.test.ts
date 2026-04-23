import { describe, expect, it } from "vitest";
import { getNavItems } from "@/lib/navigation";

describe("navigation", () => {
  it("returns basic user navigation", () => {
    expect(getNavItems("USER")).toEqual([
      { href: "/", label: "Чаты", icon: "chat" },
      { href: "/images", label: "Изображения", icon: "image" },
      { href: "/settings", label: "Настройки", icon: "settings" },
    ]);
  });

  it("includes admin panel for admins", () => {
    expect(getNavItems("ADMIN")).toEqual([
      { href: "/", label: "Чаты", icon: "chat" },
      { href: "/images", label: "Изображения", icon: "image" },
      { href: "/settings", label: "Настройки", icon: "settings" },
      { href: "/admin", label: "Админка", icon: "admin_panel_settings" },
    ]);
  });
});
