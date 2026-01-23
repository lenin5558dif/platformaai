import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(2),
  budget: z.number().nonnegative().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  budget: z.number().nonnegative().optional(),
  settings: z.record(z.unknown()).optional(),
});

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true },
  });

  if (!user?.orgId) {
    return NextResponse.json({ data: null });
  }

  const org = await prisma.organization.findUnique({
    where: { id: user.orgId },
  });

  return NextResponse.json({ data: org });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true },
  });

  if (existing?.orgId) {
    return NextResponse.json({ error: "Already in organization" }, { status: 409 });
  }

  const payload = createSchema.parse(await request.json());
  const org = await prisma.organization.create({
    data: {
      name: payload.name,
      ownerId: session.user.id,
      budget: payload.budget ?? 0,
    },
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { orgId: org.id, role: "ADMIN" },
  });

  await logAudit({
    action: "ORG_UPDATED",
    orgId: org.id,
    actorId: session.user.id,
    targetType: "organization",
    targetId: org.id,
    metadata: { created: true },
  });

  return NextResponse.json({ data: org }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, orgId: true },
  });

  if (!user?.orgId || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = updateSchema.parse(await request.json());
  const settings = payload.settings as Prisma.InputJsonValue | undefined;

  const org = await prisma.organization.update({
    where: { id: user.orgId },
    data: {
      name: payload.name,
      budget: payload.budget,
      settings,
    },
  });

  await logAudit({
    action: "ORG_UPDATED",
    orgId: user.orgId,
    actorId: session.user.id,
    targetType: "organization",
    targetId: user.orgId,
    metadata: { name: payload.name, budget: payload.budget },
  });

  return NextResponse.json({ data: org });
}
