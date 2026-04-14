import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requireSession, createAuthorizer, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { getAllTimePeriod } from "@/lib/quota-manager";

const schema = z.object({
  budget: z.number().nonnegative().nullable().optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);

    const costCenter = await prisma.costCenter.findFirst({
      where: { id, orgId: membership.orgId },
      select: { id: true },
    });

    if (!costCenter) {
      return NextResponse.json({ error: "Cost center not found" }, { status: 404 });
    }

    const allTime = getAllTimePeriod();
    const bucket = await prisma.quotaBucket.findUnique({
      where: {
        scope_subjectId_periodStart_periodEnd: {
          scope: "COST_CENTER",
          subjectId: costCenter.id,
          periodStart: allTime.start,
          periodEnd: allTime.end,
        },
      },
      select: { limit: true, spent: true },
    });

    return NextResponse.json({
      data: {
        budget: Number(bucket?.limit ?? 0),
        spent: Number(bucket?.spent ?? 0),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);

    const payload = schema.parse(await request.json());
    const newBudget = payload.budget ?? null;
    const newLimit = newBudget === null ? 0 : newBudget;

    const costCenter = await prisma.costCenter.findFirst({
      where: { id, orgId: membership.orgId },
      select: { id: true },
    });

    if (!costCenter) {
      return NextResponse.json({ error: "Cost center not found" }, { status: 404 });
    }

    const allTime = getAllTimePeriod();
    const updated = await prisma.quotaBucket.upsert({
      where: {
        scope_subjectId_periodStart_periodEnd: {
          scope: "COST_CENTER",
          subjectId: costCenter.id,
          periodStart: allTime.start,
          periodEnd: allTime.end,
        },
      },
      create: {
        orgId: membership.orgId,
        scope: "COST_CENTER",
        subjectId: costCenter.id,
        periodStart: allTime.start,
        periodEnd: allTime.end,
        limit: newLimit,
        spent: 0,
        reserved: 0,
      },
      update: {
        limit: newLimit,
      },
      select: { limit: true, spent: true },
    });

    await logAudit({
      action: "COST_CENTER_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "costCenter",
      targetId: costCenter.id,
      metadata: { budget: newBudget },
    });

    return NextResponse.json({
      data: {
        budget: Number(updated.limit ?? 0),
        spent: Number(updated.spent ?? 0),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
