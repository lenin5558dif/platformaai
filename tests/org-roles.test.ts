import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

const { mockAuthFn, mockPrismaDb } = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
  mockPrismaDb: {
    orgRole: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    orgPermission: {
      findMany: vi.fn(),
    },
    orgRolePermission: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuthFn,
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrismaDb,
}));

// Mock audit log
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

import { GET, POST } from "@/app/api/org/roles/route";
import { PATCH, DELETE } from "@/app/api/org/roles/[id]/route";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";

describe("Org Roles API", () => {
  const mockSession = {
    user: { id: "user-1", orgId: "org-1" },
  };

  const mockAdminMembership = {
    roleId: "role-admin",
    defaultCostCenterId: null,
    role: {
      name: SYSTEM_ROLE_NAMES.ADMIN,
      permissions: [
        { permission: { key: ORG_PERMISSIONS.ORG_ROLE_CHANGE } },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/org/roles", () => {
    it("lists roles with permissions and isSystem flag", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgRole.findMany.mockResolvedValue([
        {
          id: "role-1",
          name: SYSTEM_ROLE_NAMES.ADMIN,
          isSystem: true,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          permissions: [
            { permission: { key: ORG_PERMISSIONS.ORG_ROLE_CHANGE } },
            { permission: { key: ORG_PERMISSIONS.ORG_USER_MANAGE } },
          ],
          _count: { memberships: 2, invites: 0 },
        },
        {
          id: "role-2",
          name: "Custom Role",
          isSystem: false,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          permissions: [{ permission: { key: ORG_PERMISSIONS.ORG_AUDIT_READ } }],
          _count: { memberships: 1, invites: 1 },
        },
      ]);

      const response = await GET();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.data).toHaveLength(2);
      expect(json.data[0]).toMatchObject({
        id: "role-1",
        name: SYSTEM_ROLE_NAMES.ADMIN,
        isSystem: true,
        permissionKeys: [ORG_PERMISSIONS.ORG_ROLE_CHANGE, ORG_PERMISSIONS.ORG_USER_MANAGE],
        usageCount: 2,
      });
      expect(json.data[1]).toMatchObject({
        id: "role-2",
        name: "Custom Role",
        isSystem: false,
        permissionKeys: [ORG_PERMISSIONS.ORG_AUDIT_READ],
        usageCount: 2,
      });
    });

    it("returns 401 when not authenticated", async () => {
      mockAuthFn.mockResolvedValue(null);

      const response = await GET();
      expect(response.status).toBe(401);
    });

    it("returns 403 without ORG_ROLE_CHANGE permission", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue({
        roleId: "role-member",
        defaultCostCenterId: null,
        role: {
          name: SYSTEM_ROLE_NAMES.MEMBER,
          permissions: [],
        },
      });

      const response = await GET();
      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/org/roles", () => {
    it("creates custom role with permissions", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgPermission.findMany.mockResolvedValue([
        { id: "perm-1", key: ORG_PERMISSIONS.ORG_AUDIT_READ },
      ]);
      mockPrismaDb.orgRole.findUnique.mockResolvedValue(null); // No existing role
      mockPrismaDb.orgRole.create.mockResolvedValue({
        id: "new-role-id",
        name: "Auditor",
        isSystem: false,
      });
      mockPrismaDb.$transaction = vi.fn((fn) => fn(mockPrismaDb));

      const request = new Request("http://localhost/api/org/roles", {
        method: "POST",
        body: JSON.stringify({
          name: "Auditor",
          permissionKeys: [ORG_PERMISSIONS.ORG_AUDIT_READ],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.data).toMatchObject({
        id: "new-role-id",
        name: "Auditor",
        isSystem: false,
        permissionKeys: [ORG_PERMISSIONS.ORG_AUDIT_READ],
      });
    });

    it("returns 400 for unknown permission keys", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgPermission.findMany.mockResolvedValue([
        { id: "perm-1", key: ORG_PERMISSIONS.ORG_AUDIT_READ },
      ]);

      const request = new Request("http://localhost/api/org/roles", {
        method: "POST",
        body: JSON.stringify({
          name: "Bad Role",
          permissionKeys: ["unknown:permission", ORG_PERMISSIONS.ORG_AUDIT_READ],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it("returns 409 for duplicate role name", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgPermission.findMany.mockResolvedValue([]);
      mockPrismaDb.orgRole.findUnique.mockResolvedValue({
        id: "existing-role",
        name: "Existing Role",
      });

      const request = new Request("http://localhost/api/org/roles", {
        method: "POST",
        body: JSON.stringify({
          name: "Existing Role",
          permissionKeys: [],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(409);
    });

    it("deduplicates permission keys to avoid unique conflicts", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgPermission.findMany.mockResolvedValue([
        { id: "perm-1", key: ORG_PERMISSIONS.ORG_AUDIT_READ },
      ]);
      mockPrismaDb.orgRole.findUnique.mockResolvedValue(null);
      mockPrismaDb.orgRole.create.mockResolvedValue({
        id: "new-role-id",
        name: "Auditor",
        isSystem: false,
      });
      mockPrismaDb.$transaction = vi.fn((fn) => fn(mockPrismaDb));

      const request = new Request("http://localhost/api/org/roles", {
        method: "POST",
        body: JSON.stringify({
          name: "Auditor",
          permissionKeys: [
            ORG_PERMISSIONS.ORG_AUDIT_READ,
            ORG_PERMISSIONS.ORG_AUDIT_READ,
          ],
        }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(json.data.permissionKeys).toEqual([ORG_PERMISSIONS.ORG_AUDIT_READ]);
      expect(mockPrismaDb.orgRolePermission.createMany).toHaveBeenCalledWith({
        data: [{ roleId: "new-role-id", permissionId: "perm-1" }],
      });
    });
  });

  describe("PATCH /api/org/roles/[id]", () => {
    it("updates non-system role permissions", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgRole.findFirst.mockResolvedValue({
        id: "role-2",
        name: "Custom Role",
        isSystem: false,
        permissions: [],
      });
      mockPrismaDb.orgPermission.findMany.mockResolvedValue([
        { id: "perm-1", key: ORG_PERMISSIONS.ORG_ANALYTICS_READ },
      ]);
      mockPrismaDb.$transaction = vi.fn((fn) =>
        fn({
          ...mockPrismaDb,
          orgRole: {
            ...mockPrismaDb.orgRole,
            findUnique: vi.fn().mockResolvedValue({
              id: "role-2",
              name: "Custom Role",
              isSystem: false,
              permissions: [{ permission: { key: ORG_PERMISSIONS.ORG_ANALYTICS_READ } }],
            }),
          },
        })
      );

      const request = new Request("http://localhost/api/org/roles/role-2", {
        method: "PATCH",
        body: JSON.stringify({
          permissionKeys: [ORG_PERMISSIONS.ORG_ANALYTICS_READ],
        }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: "role-2" }) });
      expect(response.status).toBe(200);
    });

    it("returns 403 when updating system role", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgRole.findFirst.mockResolvedValue({
        id: "role-1",
        name: SYSTEM_ROLE_NAMES.ADMIN,
        isSystem: true,
        permissions: [],
      });

      const request = new Request("http://localhost/api/org/roles/role-1", {
        method: "PATCH",
        body: JSON.stringify({
          permissionKeys: [ORG_PERMISSIONS.ORG_ANALYTICS_READ],
        }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: "role-1" }) });
      expect(response.status).toBe(403);
    });

    it("returns 404 for role in different org", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgRole.findFirst.mockResolvedValue(null);

      const request = new Request("http://localhost/api/org/roles/role-other-org", {
        method: "PATCH",
        body: JSON.stringify({
          permissionKeys: [ORG_PERMISSIONS.ORG_ANALYTICS_READ],
        }),
      });

      const response = await PATCH(request, { params: Promise.resolve({ id: "role-other-org" }) });
      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/org/roles/[id]", () => {
    it("deletes unused non-system role", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgRole.findFirst.mockResolvedValue({
        id: "role-2",
        name: "Custom Role",
        isSystem: false,
        _count: { memberships: 0, invites: 0 },
      });
      mockPrismaDb.orgRole.delete.mockResolvedValue({});

      const request = new Request("http://localhost/api/org/roles/role-2", {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: "role-2" }) });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.data).toEqual({ deleted: true });
    });

    it("returns 409 when deleting role in use", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgRole.findFirst.mockResolvedValue({
        id: "role-2",
        name: "Custom Role",
        isSystem: false,
        _count: { memberships: 2, invites: 1 },
      });

      const request = new Request("http://localhost/api/org/roles/role-2", {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: "role-2" }) });
      expect(response.status).toBe(409);
    });

    it("returns 403 when deleting system role", async () => {
      mockAuthFn.mockResolvedValue(mockSession);
      mockPrismaDb.orgMembership.findUnique.mockResolvedValue(mockAdminMembership);
      mockPrismaDb.orgRole.findFirst.mockResolvedValue({
        id: "role-1",
        name: SYSTEM_ROLE_NAMES.ADMIN,
        isSystem: true,
        _count: { memberships: 0, invites: 0 },
      });

      const request = new Request("http://localhost/api/org/roles/role-1", {
        method: "DELETE",
      });

      const response = await DELETE(request, { params: Promise.resolve({ id: "role-1" }) });
      expect(response.status).toBe(403);
    });
  });
});
