import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

const patchSchema = z.object({
  defaultCostCenterId: z.string().min(1).nullable().optional(),
  allowedCostCenterIds: z.array(z.string().min(1)).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE
    );

    const { id: targetUserId } = await params;
    const payload = patchSchema.parse(await request.json());

    const targetMembership = await prisma.orgMembership.findUnique({
      where: {
        orgId_userId: {
          orgId: membership.orgId,
          userId: targetUserId,
        },
      },
      select: { id: true },
    });

    if (!targetMembership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Validate that provided cost centers belong to the org
    const costCenterIdsToValidate: string[] = [];
    if (payload.defaultCostCenterId) {
      costCenterIdsToValidate.push(payload.defaultCostCenterId);
    }
    if (payload.allowedCostCenterIds) {
      costCenterIdsToValidate.push(...payload.allowedCostCenterIds);
    }

    if (costCenterIdsToValidate.length > 0) {
      const validCostCenters = await prisma.costCenter.findMany({
        where: {
          id: { in: [...new Set(costCenterIdsToValidate)] },
          orgId: membership.orgId,
        },
        select: { id: true },
      });
      const validIds = new Set(validCostCenters.map((c) => c.id));

      for (const id of costCenterIdsToValidate) {
        if (!validIds.has(id)) {
          return NextResponse.json(
            { error: `Cost center ${id} not found in organization` },
            { status: 400 }
          );
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // Update default cost center if provided
      if (payload.defaultCostCenterId !== undefined) {
        await tx.orgMembership.update({
          where: { id: targetMembership.id },
          data: { defaultCostCenterId: payload.defaultCostCenterId },
        });
      }

      // Update allowed cost centers if provided
      if (payload.allowedCostCenterIds !== undefined) {
        // If empty array, delete all allowed rows (revert to allow-all)
        if (payload.allowedCostCenterIds.length === 0) {
          await tx.orgMembershipAllowedCostCenter.deleteMany({
            where: { membershipId: targetMembership.id },
          });
        } else {
          // Delete existing and create new allowed set
          await tx.orgMembershipAllowedCostCenter.deleteMany({
            where: { membershipId: targetMembership.id },
          });
          await tx.orgMembershipAllowedCostCenter.createMany({
            data: payload.allowedCostCenterIds.map((costCenterId) => ({
              membershipId: targetMembership.id,
              costCenterId,
            })),
          });
        }
      }
    });

    await logAudit({
      action: "COST_CENTER_ASSIGNED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: targetUserId,
      metadata: {
        defaultCostCenterId: payload.defaultCostCenterId,
        allowedCostCenterIds: payload.allowedCostCenterIds,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE
    );

    const { id: targetUserId } = await params;

    const targetMembership = await prisma.orgMembership.findUnique({
      where: {
        orgId_userId: {
          orgId: membership.orgId,
          userId: targetUserId,
        },
      },
      select: {
        id: true,
        defaultCostCenterId: true,
        allowedCostCenters: {
          select: { costCenterId: true },
        },
      },
    });

    if (!targetMembership) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      defaultCostCenterId: targetMembership.defaultCostCenterId,
      allowedCostCenterIds: targetMembership.allowedCostCenters.map(
        (ac) => ac.costCenterId
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
