import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

const { mockAuthFn, mockPrismaDb } = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
  mockPrismaDb: {
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    orgRole: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(mockPrismaDb)),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuthFn,
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrismaDb,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

import { DELETE } from "@/app/api/org/users/[id]/route";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

describe("Owner invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cannot remove last owner (409)", async () => {
    mockAuthFn.mockResolvedValue({
      user: { id: "admin-1", orgId: "org-1" },
    });

    // 1) createAuthorizer permission check membership for admin
    mockPrismaDb.orgMembership.findUnique.mockResolvedValueOnce({
      roleId: "role-admin",
      defaultCostCenterId: null,
      role: {
        name: "Admin",
        permissions: [
          { permission: { key: ORG_PERMISSIONS.ORG_USER_MANAGE } },
        ],
      },
    });

    // 2) currentMembership for target user
    mockPrismaDb.orgMembership.findUnique.mockResolvedValueOnce({
      id: "m-target",
      roleId: "role-owner",
      role: { name: "Owner" },
    });

    mockPrismaDb.orgRole.findUnique.mockResolvedValue({ id: "role-owner" });

    // 3) assertNotLastOwner() re-check target role
    mockPrismaDb.orgMembership.findUnique.mockResolvedValueOnce({
      roleId: "role-owner",
    });

    mockPrismaDb.orgMembership.count.mockResolvedValue(1);

    const req = new Request("http://localhost/api/org/users/u2", {
      method: "DELETE",
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: "u2" }) });
    expect(res.status).toBe(409);
  });
});
