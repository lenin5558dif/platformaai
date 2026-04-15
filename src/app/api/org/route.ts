import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";
import { ensureOrgSystemRolesAndPermissions } from "@/lib/org-rbac";

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
  try {
    const session = await requireSession();

    const existing = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { orgId: true },
    });

    if (existing?.orgId) {
      return NextResponse.json(
        { error: "Already in organization" },
        { status: 409 }
      );
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

    // Initialize RBAC for the newly created org and create the creator membership.
    const { rolesByName } = await ensureOrgSystemRolesAndPermissions(org.id);
    const ownerRole = rolesByName.get(SYSTEM_ROLE_NAMES.OWNER);
    if (ownerRole) {
      await prisma.orgMembership.upsert({
        where: {
          orgId_userId: {
            orgId: org.id,
            userId: session.user.id,
          },
        },
        update: {
          roleId: ownerRole.id,
        },
        create: {
          orgId: org.id,
          userId: session.user.id,
          roleId: ownerRole.id,
        },
      });
    }

    await logAudit({
      action: "ORG_UPDATED",
      orgId: org.id,
      actorId: session.user.id,
      targetType: "organization",
      targetId: org.id,
      metadata: { created: true },
    });

    return NextResponse.json({ data: org }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);

    const payload = updateSchema.parse(await request.json());
    const membership = await authorizer.requireOrgMembership();
    const settings = payload.settings as Prisma.InputJsonValue | undefined;

    if (payload.name !== undefined || payload.settings !== undefined) {
      await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_SETTINGS_UPDATE);
    }

    if (payload.budget !== undefined) {
      await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);
    }

    const org = await prisma.organization.update({
      where: { id: membership.orgId },
      data: {
        name: payload.name,
        budget: payload.budget,
        settings,
      },
    });

    await logAudit({
      action: "ORG_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "organization",
      targetId: membership.orgId,
      metadata: { name: payload.name, budget: payload.budget },
    });

    return NextResponse.json({ data: org });
  } catch (error) {
    return toErrorResponse(error);
  }
}
