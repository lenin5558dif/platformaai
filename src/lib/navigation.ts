type NavItem = {
  href: string;
  label: string;
  icon: string;
};

const B2C_ITEMS: NavItem[] = [
  { href: "/", label: "Чаты", icon: "chat" },
  { href: "/images", label: "Изображения", icon: "image" },
  { href: "/settings", label: "Настройки", icon: "settings" },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin", label: "Админка", icon: "admin_panel_settings" },
];

export function getNavItems(role?: string | null): NavItem[] {
  if (role === "ADMIN") {
    return [...B2C_ITEMS, ...ADMIN_ITEMS];
  }

  return [...B2C_ITEMS];
}
