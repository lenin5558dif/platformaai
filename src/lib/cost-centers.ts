import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/authorize";

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

export async function resolveOrgCostCenterId(params: {
  orgId: string;
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
  return candidate;
}
