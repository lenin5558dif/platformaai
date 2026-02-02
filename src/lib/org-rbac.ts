import { prisma } from "@/lib/db";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";

function systemRolePermissionKeys(roleName: string): string[] {
  // Keep a small, opinionated default set; can be tuned later.
  switch (roleName) {
    case SYSTEM_ROLE_NAMES.OWNER:
      return Object.values(ORG_PERMISSIONS);
    case SYSTEM_ROLE_NAMES.ADMIN:
      return [
        ORG_PERMISSIONS.ORG_SETTINGS_UPDATE,
        ORG_PERMISSIONS.ORG_USER_MANAGE,
        ORG_PERMISSIONS.ORG_INVITE_CREATE,
        ORG_PERMISSIONS.ORG_INVITE_REVOKE,
        ORG_PERMISSIONS.ORG_ROLE_CHANGE,
        ORG_PERMISSIONS.ORG_BILLING_MANAGE,
        ORG_PERMISSIONS.ORG_BILLING_REFILL,
        ORG_PERMISSIONS.ORG_POLICY_UPDATE,
        ORG_PERMISSIONS.ORG_AUDIT_READ,
        ORG_PERMISSIONS.ORG_ANALYTICS_READ,
        ORG_PERMISSIONS.ORG_SCIM_MANAGE,
        ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE,
        ORG_PERMISSIONS.ORG_LIMITS_MANAGE,
      ];
    case SYSTEM_ROLE_NAMES.MANAGER:
      return [ORG_PERMISSIONS.ORG_ANALYTICS_READ, ORG_PERMISSIONS.ORG_AUDIT_READ];
    case SYSTEM_ROLE_NAMES.MEMBER:
    default:
      return [];
  }
}

async function ensureOrgPermission(key: string, description?: string) {
  const existing = await prisma.orgPermission.findUnique({ where: { key } });
  if (existing) return existing;
  return prisma.orgPermission.create({ data: { key, description } });
}

export async function ensureOrgPermissions() {
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_SETTINGS_UPDATE, "Update organization settings");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_USER_MANAGE, "Manage organization users");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_INVITE_CREATE, "Create invites");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_INVITE_REVOKE, "Revoke invites");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_ROLE_CHANGE, "Change member roles");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_BILLING_MANAGE, "Manage billing and budget");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_BILLING_REFILL, "Refill user balance (admin)");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_POLICY_UPDATE, "Update model and DLP policies");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_AUDIT_READ, "Read audit log");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_ANALYTICS_READ, "Read analytics");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_SCIM_MANAGE, "Manage SCIM tokens and provisioning");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE, "Manage cost centers");
  await ensureOrgPermission(ORG_PERMISSIONS.ORG_LIMITS_MANAGE, "Manage user limits and quotas");
}

async function ensureSystemRole(orgId: string, name: string) {
  return prisma.orgRole.upsert({
    where: {
      orgId_name: {
        orgId,
        name,
      },
    },
    update: {
      isSystem: true,
    },
    create: {
      orgId,
      name,
      isSystem: true,
    },
  });
}

async function ensureRolePermission(roleId: string, permissionId: string) {
  await prisma.orgRolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId,
        permissionId,
      },
    },
    update: {},
    create: {
      roleId,
      permissionId,
    },
  });
}

export async function ensureOrgSystemRolesAndPermissions(orgId: string) {
  await ensureOrgPermissions();

  const permissions = await prisma.orgPermission.findMany({
    where: {
      key: {
        in: Object.values(ORG_PERMISSIONS),
      },
    },
    select: { id: true, key: true },
  });

  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id] as const));

  const roles = await Promise.all([
    ensureSystemRole(orgId, SYSTEM_ROLE_NAMES.OWNER),
    ensureSystemRole(orgId, SYSTEM_ROLE_NAMES.ADMIN),
    ensureSystemRole(orgId, SYSTEM_ROLE_NAMES.MANAGER),
    ensureSystemRole(orgId, SYSTEM_ROLE_NAMES.MEMBER),
  ]);

  for (const role of roles) {
    const keys = systemRolePermissionKeys(role.name);
    for (const key of keys) {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) continue;
      await ensureRolePermission(role.id, permissionId);
    }
  }

  return {
    rolesByName: new Map(roles.map((r) => [r.name, r] as const)),
  };
}
