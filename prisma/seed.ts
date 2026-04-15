import { PrismaClient, UserRole } from "@prisma/client";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "../src/lib/org-permissions";
import { BILLING_PLANS } from "../src/lib/plans";

const prisma = new PrismaClient();

async function ensureOrgPermission(key: string, description?: string) {
  const existing = await prisma.orgPermission.findUnique({ where: { key } });
  if (existing) return existing;
  return prisma.orgPermission.create({ data: { key, description } });
}

async function ensureSystemRole(orgId: string, name: string) {
  const existing = await prisma.orgRole.findUnique({
    where: {
      orgId_name: {
        orgId,
        name,
      },
    },
  });

  if (existing) return existing;

  return prisma.orgRole.create({
    data: {
      orgId,
      name,
      isSystem: true,
    },
  });
}

async function ensureRolePermission(roleId: string, permissionId: string) {
  const existing = await prisma.orgRolePermission.findUnique({
    where: {
      roleId_permissionId: {
        roleId,
        permissionId,
      },
    },
  });

  if (existing) return existing;

  return prisma.orgRolePermission.create({
    data: {
      roleId,
      permissionId,
    },
  });
}

async function seedPermissions() {
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

async function seedBillingPlans() {
  for (const plan of BILLING_PLANS) {
    await prisma.billingPlan.upsert({
      where: { code: plan.id },
      update: {
        name: plan.name,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        includedCreditsPerMonth: plan.includedCreditsPerMonth ?? 0,
        isActive: true,
      },
      create: {
        code: plan.id,
        name: plan.name,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        includedCreditsPerMonth: plan.includedCreditsPerMonth ?? 0,
        isActive: true,
      },
    });
  }
}

function systemRolePermissionKeys(name: string): string[] {
  // Keep minimal-but-useful defaults; can be refined later.
  switch (name) {
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
      return [
        ORG_PERMISSIONS.ORG_ANALYTICS_READ,
        ORG_PERMISSIONS.ORG_AUDIT_READ,
      ];
    case SYSTEM_ROLE_NAMES.MEMBER:
    default:
      return [];
  }
}

async function ensureOrgSystemRolesAndPermissions(orgId: string) {
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

async function backfillOrgMemberships() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, ownerId: true },
  });
  const orgOwnerById = new Map(orgs.map((o) => [o.id, o.ownerId] as const));

  const users = await prisma.user.findMany({
    where: { orgId: { not: null } },
    select: { id: true, orgId: true, role: true, costCenterId: true },
  });

  for (const user of users) {
    const orgId = user.orgId;
    if (!orgId) continue;

    const { rolesByName } = await ensureOrgSystemRolesAndPermissions(orgId);
    const ownerId = orgOwnerById.get(orgId);

    const roleName =
      ownerId && ownerId === user.id
        ? SYSTEM_ROLE_NAMES.OWNER
        : user.role === UserRole.ADMIN
          ? SYSTEM_ROLE_NAMES.ADMIN
          : SYSTEM_ROLE_NAMES.MEMBER;

    const role = rolesByName.get(roleName) ?? rolesByName.get(SYSTEM_ROLE_NAMES.MEMBER);
    if (!role) continue;

    await prisma.orgMembership.upsert({
      where: {
        orgId_userId: {
          orgId,
          userId: user.id,
        },
      },
      update: {
        roleId: role.id,
        defaultCostCenterId: user.costCenterId ?? undefined,
      },
      create: {
        orgId,
        userId: user.id,
        roleId: role.id,
        defaultCostCenterId: user.costCenterId ?? undefined,
      },
    });
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed script must not run in production!");
  }

  await seedPermissions();
  await seedBillingPlans();

  const user = await prisma.user.upsert({
    where: { email: "demo@platforma.ai" },
    update: {},
    create: {
      email: "demo@platforma.ai",
      role: "ADMIN",
      balance: 100,
    },
  });

  const organization = await prisma.organization.upsert({
    where: { id: "default-org" },
    update: { ownerId: user.id },
    create: {
      id: "default-org",
      name: "PlatformaAI",
      ownerId: user.id,
      settings: {},
      budget: 1000,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { orgId: "default-org" },
  });

  const { rolesByName } = await ensureOrgSystemRolesAndPermissions(organization.id);
  const ownerRole = rolesByName.get(SYSTEM_ROLE_NAMES.OWNER);
  if (ownerRole) {
    await prisma.orgMembership.upsert({
      where: {
        orgId_userId: {
          orgId: organization.id,
          userId: user.id,
        },
      },
      update: {
        roleId: ownerRole.id,
      },
      create: {
        orgId: organization.id,
        userId: user.id,
        roleId: ownerRole.id,
      },
    });
  }

  await backfillOrgMemberships();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
