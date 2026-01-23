import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

  await prisma.organization.upsert({
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
