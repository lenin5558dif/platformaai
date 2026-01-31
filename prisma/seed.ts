import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function ensureSystemRole(name: string) {
  const existing = await prisma.orgRole.findFirst({
    where: { name, isSystem: true, orgId: null },
  });

  if (existing) return existing;

  return prisma.orgRole.create({
    data: {
      name,
      isSystem: true,
    },
  });
}

async function main() {
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

  const ownerRole = await ensureSystemRole("Owner");
  await ensureSystemRole("Admin");
  await ensureSystemRole("Manager");
  await ensureSystemRole("Member");

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

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
