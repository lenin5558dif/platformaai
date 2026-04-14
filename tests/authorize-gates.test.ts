import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

const { mockAuthFn, mockPrismaDb } = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
  mockPrismaDb: {
    user: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuthFn,
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrismaDb,
}));

import { createAuthorizer } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { HttpError } from "@/lib/http-error";

describe("RBAC gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("membership gate: no org -> 403", async () => {
    const authorizer = createAuthorizer({
      user: { id: "u1" },
    } as any);

    await expect(authorizer.requireOrgMembership()).rejects.toEqual(
      expect.objectContaining({
        status: 403,
        code: "FORBIDDEN",
      })
    );
  });

  it("membership gate: missing membership -> 403", async () => {
    mockPrismaDb.orgMembership.findUnique.mockResolvedValue(null);

    const authorizer = createAuthorizer({
      user: { id: "u1", orgId: "org-1" },
    } as any);

    await expect(authorizer.requireOrgMembership()).rejects.toBeInstanceOf(HttpError);
  });

  it("permission gate: missing permission -> 403", async () => {
    mockPrismaDb.orgMembership.findUnique.mockResolvedValue({
      roleId: "r1",
      defaultCostCenterId: null,
      role: {
        name: "Member",
        permissions: [],
      },
    });

    const authorizer = createAuthorizer({
      user: { id: "u1", orgId: "org-1" },
    } as any);

    await expect(
      authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_USER_MANAGE)
    ).rejects.toEqual(
      expect.objectContaining({
        status: 403,
        code: "FORBIDDEN",
      })
    );
  });

  it("permission gate: permission present -> ok", async () => {
    mockPrismaDb.orgMembership.findUnique.mockResolvedValue({
      roleId: "r1",
      defaultCostCenterId: null,
      role: {
        name: "Admin",
        permissions: [
          {
            permission: { key: ORG_PERMISSIONS.ORG_USER_MANAGE },
          },
        ],
      },
    });

    const authorizer = createAuthorizer({
      user: { id: "u1", orgId: "org-1" },
    } as any);

    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_USER_MANAGE
    );
    expect(membership.orgId).toBe("org-1");
  });
});
