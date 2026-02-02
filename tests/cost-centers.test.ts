import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrismaDb } = vi.hoisted(() => ({
  mockPrismaDb: {
    costCenter: {
      findFirst: vi.fn(),
    },
    orgMembership: {
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
    const resolved = await resolveOrgCostCenterId({
      orgId: "org-1",
      requestedCostCenterId: "cc-1",
      defaultCostCenterId: null,
      fallbackCostCenterId: null,
    });
    expect(resolved).toBe("cc-1");
  });

  it("falls back to membership default", async () => {
    mockPrismaDb.costCenter.findFirst.mockResolvedValue({ id: "cc-2" });
    const resolved = await resolveOrgCostCenterId({
      orgId: "org-1",
      requestedCostCenterId: null,
      defaultCostCenterId: "cc-2",
      fallbackCostCenterId: "cc-legacy",
    });
    expect(resolved).toBe("cc-2");
  });
});
