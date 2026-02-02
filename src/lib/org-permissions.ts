export const ORG_PERMISSIONS = {
  ORG_SETTINGS_UPDATE: "org:settings.update",
  ORG_USER_MANAGE: "org:user.manage",
  ORG_INVITE_CREATE: "org:invite.create",
  ORG_INVITE_REVOKE: "org:invite.revoke",
  ORG_ROLE_CHANGE: "org:role.change",
  ORG_BILLING_MANAGE: "org:billing.manage",
  ORG_BILLING_REFILL: "org:billing.refill",
  ORG_POLICY_UPDATE: "org:policy.update",
  ORG_AUDIT_READ: "org:audit.read",
  ORG_ANALYTICS_READ: "org:analytics.read",
  ORG_SCIM_MANAGE: "org:scim.manage",
  ORG_COST_CENTER_MANAGE: "org:cost-center.manage",
  ORG_LIMITS_MANAGE: "org:limits.manage",
} as const;

export type OrgPermissionKey =
  (typeof ORG_PERMISSIONS)[keyof typeof ORG_PERMISSIONS];

export const SYSTEM_ROLE_NAMES = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  MEMBER: "Member",
} as const;

export type SystemRoleName =
  (typeof SYSTEM_ROLE_NAMES)[keyof typeof SYSTEM_ROLE_NAMES];
