import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrismaDb } = vi.hoisted(() => ({
  mockPrismaDb: {
    costCenter: {
      findFirst: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
    orgMembershipAllowedCostCenter: {
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrismaDb,
}));

import {
  assertCostCenterAccess,
  resolveOrgCostCenterId,
  isCostCenterAllowedForMembership,
} from "@/lib/cost-centers";
import { HttpError } from "@/lib/http-error";

describe("Cost centers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects cost center from another org", async () => {
    mockPrismaDb.costCenter.findFirst.mockResolvedValue(null);
    await expect(
      assertCostCenterAccess({ orgId: "org-1", costCenterId: "cc-x" })
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("resolves requested cost center when valid", async () => {
    mockPrismaDb.costCenter.findFirst.mockResolvedValue({ id: "cc-1" });
    mockPrismaDb.orgMembershipAllowedCostCenter.count.mockResolvedValue(0);
    const resolved = await resolveOrgCostCenterId({
      orgId: "org-1",
      membershipId: "mem-1",
      requestedCostCenterId: "cc-1",
      defaultCostCenterId: null,
      fallbackCostCenterId: null,
    });
    expect(resolved).toBe("cc-1");
  });

  it("falls back to membership default", async () => {
    mockPrismaDb.costCenter.findFirst.mockResolvedValue({ id: "cc-2" });
    mockPrismaDb.orgMembershipAllowedCostCenter.count.mockResolvedValue(0);
    const resolved = await resolveOrgCostCenterId({
      orgId: "org-1",
      membershipId: "mem-1",
      requestedCostCenterId: null,
      defaultCostCenterId: "cc-2",
      fallbackCostCenterId: "cc-legacy",
    });
    expect(resolved).toBe("cc-2");
  });
});

describe("Allowed cost centers ABAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows any cost center when no allowed rows exist (allow-all semantics)", async () => {
    mockPrismaDb.orgMembershipAllowedCostCenter.count.mockResolvedValue(0);
    const allowed = await isCostCenterAllowedForMembership({
      membershipId: "mem-1",
      costCenterId: "cc-1",
    });
    expect(allowed).toBe(true);
    expect(mockPrismaDb.orgMembershipAllowedCostCenter.count).toHaveBeenCalledWith({
      where: { membershipId: "mem-1" },
    });
    expect(mockPrismaDb.orgMembershipAllowedCostCenter.findUnique).not.toHaveBeenCalled();
  });

  it("allows cost center when it is in the allowed set", async () => {
    mockPrismaDb.orgMembershipAllowedCostCenter.count.mockResolvedValue(2);
    mockPrismaDb.orgMembershipAllowedCostCenter.findUnique.mockResolvedValue({ id: "allowed-1" });
    const allowed = await isCostCenterAllowedForMembership({
      membershipId: "mem-1",
      costCenterId: "cc-1",
    });
    expect(allowed).toBe(true);
    expect(mockPrismaDb.orgMembershipAllowedCostCenter.findUnique).toHaveBeenCalledWith({
      where: {
        membershipId_costCenterId: {
          membershipId: "mem-1",
          costCenterId: "cc-1",
        },
      },
      select: { id: true },
    });
  });

  it("denies cost center when it is not in the allowed set", async () => {
    mockPrismaDb.orgMembershipAllowedCostCenter.count.mockResolvedValue(2);
    mockPrismaDb.orgMembershipAllowedCostCenter.findUnique.mockResolvedValue(null);
    const allowed = await isCostCenterAllowedForMembership({
      membershipId: "mem-1",
      costCenterId: "cc-1",
    });
    expect(allowed).toBe(false);
  });

  it("rejects cost center not in allowed set during resolution", async () => {
    mockPrismaDb.costCenter.findFirst.mockResolvedValue({ id: "cc-1" });
    mockPrismaDb.orgMembershipAllowedCostCenter.count.mockResolvedValue(1);
    mockPrismaDb.orgMembershipAllowedCostCenter.findUnique.mockResolvedValue(null);
    await expect(
      resolveOrgCostCenterId({
        orgId: "org-1",
        membershipId: "mem-1",
        requestedCostCenterId: "cc-1",
        defaultCostCenterId: null,
        fallbackCostCenterId: null,
      })
    ).rejects.toBeInstanceOf(HttpError);
  });
});
