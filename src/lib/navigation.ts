type NavItem = {
  href: string;
  label: string;
  icon: string;
};

const B2C_ITEMS: NavItem[] = [
  { href: "/", label: "Чаты", icon: "chat" },
  { href: "/settings", label: "Настройки", icon: "settings" },
];

export function getNavItems(role?: string | null): NavItem[] {
  void role;
  return [...B2C_ITEMS];
}
