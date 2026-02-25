type NavItem = {
  href: string;
  label: string;
  icon: string;
};

const B2C_ITEMS: NavItem[] = [
  { href: "/", label: "Чаты", icon: "chat" },
  { href: "/settings", label: "Настройки", icon: "settings" },
];

const B2B_ITEMS: NavItem[] = [
  { href: "/org", label: "Организация", icon: "grid_view" },
  { href: "/timeline", label: "Лента", icon: "view_timeline" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/events", label: "События", icon: "history" },
  { href: "/admin", label: "Админ", icon: "admin_panel_settings" },
  { href: "/audit", label: "Аудит", icon: "policy" },
];

export function getNavItems(role?: string | null): NavItem[] {
  const normalizedRole = role ?? "USER";
  const items = [...B2C_ITEMS];

  if (normalizedRole !== "USER") {
    items.push(...B2B_ITEMS);
  }

  if (normalizedRole === "ADMIN") {
    items.push(...ADMIN_ITEMS);
  }

  return items;
}
