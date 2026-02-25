import { ORG_PERMISSIONS, type OrgPermissionKey } from "@/lib/org-permissions";

type RbacApiErrorCode =
  | "FORBIDDEN"
  | "LAST_OWNER"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "ROLE_NOT_FOUND"
  | "ROLE_IN_USE"
  | "SYSTEM_ROLE_IMMUTABLE"
  | string;

export type RbacUiMessage = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
};

export type RbacRoleView = {
  id: string;
  name: string;
  isSystem: boolean;
  permissionKeys: string[];
};

export type RbacMemberView = {
  id: string;
  email: string | null;
  legacyRole: string;
  isActive: boolean;
  balance: string;
  dailyLimit: string | null;
  monthlyLimit: string | null;
  costCenterId: string | null;
  defaultCostCenterId: string | null;
  role: {
    id: string;
    name: string;
    permissionKeys: string[];
  } | null;
};

type PermissionGroup = {
  id: string;
  label: string;
  permissions: OrgPermissionKey[];
};

export const RBAC_PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "invite",
    label: "Invite",
    permissions: [ORG_PERMISSIONS.ORG_INVITE_CREATE, ORG_PERMISSIONS.ORG_INVITE_REVOKE],
  },
  {
    id: "role-change",
    label: "Role Change",
    permissions: [ORG_PERMISSIONS.ORG_ROLE_CHANGE],
  },
  {
    id: "billing",
    label: "Billing",
    permissions: [ORG_PERMISSIONS.ORG_BILLING_MANAGE, ORG_PERMISSIONS.ORG_BILLING_REFILL],
  },
  {
    id: "policy",
    label: "Policy",
    permissions: [ORG_PERMISSIONS.ORG_POLICY_UPDATE],
  },
  {
    id: "analytics",
    label: "Analytics",
    permissions: [ORG_PERMISSIONS.ORG_ANALYTICS_READ, ORG_PERMISSIONS.ORG_AUDIT_READ],
  },
];

export function mapRbacError(code?: RbacApiErrorCode): RbacUiMessage {
  switch (code) {
    case "FORBIDDEN":
      return {
        tone: "warning",
        title: "Недостаточно прав",
        message: "У вас нет прав на это действие. Обратитесь к администратору организации.",
      };
    case "LAST_OWNER":
      return {
        tone: "warning",
        title: "Нельзя снять последнего Owner",
        message: "Назначьте другого Owner перед изменением этой роли.",
      };
    case "ROLE_NOT_FOUND":
    case "NOT_FOUND":
      return {
        tone: "error",
        title: "Роль или пользователь не найдены",
        message: "Обновите страницу и попробуйте снова.",
      };
    case "RATE_LIMITED":
      return {
        tone: "warning",
        title: "Слишком много запросов",
        message: "Операция временно ограничена. Повторите позже.",
      };
    case "SYSTEM_ROLE_IMMUTABLE":
      return {
        tone: "warning",
        title: "Системная роль защищена",
        message: "Эту системную роль нельзя менять напрямую.",
      };
    case "UNAUTHORIZED":
      return {
        tone: "warning",
        title: "Нужна авторизация",
        message: "Войдите заново и повторите действие.",
      };
    default:
      return {
        tone: "error",
        title: "Операция не выполнена",
        message: "Попробуйте снова. Если ошибка повторяется, обратитесь к администратору.",
      };
  }
}

export function hasPermission(permissionKeys: string[], key: string): boolean {
  return permissionKeys.includes(key);
}

export function roleHasGroupPermission(role: RbacRoleView, group: PermissionGroup): boolean {
  return group.permissions.some((permission) => role.permissionKeys.includes(permission));
}
