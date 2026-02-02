import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http-error";

export async function assertCostCenterAccess(params: {
  orgId: string;
  costCenterId: string;
}) {
  const record = await prisma.costCenter.findFirst({
    where: { id: params.costCenterId, orgId: params.orgId },
    select: { id: true },
  });

  if (!record) {
    throw new HttpError(403, "COST_CENTER_FORBIDDEN", "Invalid cost center");
  }
}

export async function assertCostCenterAccessForUser(params: {
  userId: string;
  orgId: string;
  costCenterId: string;
}) {
  const membership = await prisma.orgMembership.findUnique({
    where: {
      orgId_userId: {
        orgId: params.orgId,
        userId: params.userId,
      },
    },
    select: { id: true },
  });

  if (!membership) {
    throw new HttpError(403, "FORBIDDEN", "Forbidden");
  }

  await assertCostCenterAccess({
    orgId: params.orgId,
    costCenterId: params.costCenterId,
  });
}

/**
 * Check if a cost center is in the allowed set for a membership.
 * Semantics: if membership has 0 allowed rows => allow all org cost centers.
 * If >0 rows => allow only those listed.
 */
export async function isCostCenterAllowedForMembership(params: {
  membershipId: string;
  costCenterId: string;
}): Promise<boolean> {
  const allowedCount = await prisma.orgMembershipAllowedCostCenter.count({
    where: { membershipId: params.membershipId },
  });

  // No restrictions => allow all
  if (allowedCount === 0) {
    return true;
  }

  // Check if the requested cost center is in the allowed set
  const allowed = await prisma.orgMembershipAllowedCostCenter.findUnique({
    where: {
      membershipId_costCenterId: {
        membershipId: params.membershipId,
        costCenterId: params.costCenterId,
      },
    },
    select: { id: true },
  });

  return Boolean(allowed);
}

export async function resolveOrgCostCenterId(params: {
  orgId: string;
  membershipId?: string;
  requestedCostCenterId?: string | null;
  defaultCostCenterId?: string | null;
  fallbackCostCenterId?: string | null;
}): Promise<string | undefined> {
  // Selection order:
  // 1) Explicit request override
  // 2) Membership default
  // 3) Legacy user-level default
  const candidate =
    params.requestedCostCenterId ??
    params.defaultCostCenterId ??
    params.fallbackCostCenterId ??
    null;

  if (!candidate) {
    return undefined;
  }

  await assertCostCenterAccess({ orgId: params.orgId, costCenterId: candidate });

  // Enforce allowed set if membershipId is provided
  if (params.membershipId) {
    const allowed = await isCostCenterAllowedForMembership({
      membershipId: params.membershipId,
      costCenterId: candidate,
    });
    if (!allowed) {
      throw new HttpError(403, "COST_CENTER_FORBIDDEN", "Cost center not allowed for this user");
    }
  }

  return candidate;
}
