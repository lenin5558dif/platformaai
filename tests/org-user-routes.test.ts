import { beforeEach, describe, expect, test, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";

const state = vi.hoisted(() => ({
  session: { user: { id: "actor-1", orgId: "org-1" } },
  membership: { orgId: "org-1" },
}));

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createAuthorizer: vi.fn(),
  toErrorResponse: vi.fn(),
  logAudit: vi.fn(),
  prisma: {
    orgRole: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/lib/authorize", () => ({
  requireSession: mocks.requireSession,
  createAuthorizer: mocks.createAuthorizer,
  toErrorResponse: mocks.toErrorResponse,
}));

import { DELETE, PATCH } from "@/app/api/org/users/[id]/route";

describe("org user routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireSession.mockResolvedValue(state.session);
    mocks.createAuthorizer.mockReturnValue({
      requireOrgPermission: vi.fn(async (permission: string) => {
        if (
          permission !== ORG_PERMISSIONS.ORG_ROLE_CHANGE &&
          permission !== ORG_PERMISSIONS.ORG_USER_MANAGE
        ) {
          throw new Error(`Unexpected permission: ${permission}`);
        }
        return state.membership;
      }),
    });
    mocks.toErrorResponse.mockImplementation((error: unknown) => {
      if (error instanceof HttpError) {
        return new Response(JSON.stringify({ code: error.code }), {
          status: error.status,
          headers: { "content-type": "application/json" },
        });
      }
      throw error;
    });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        orgMembership: { delete: mocks.prisma.orgMembership.delete },
        user: { updateMany: mocks.prisma.user.updateMany },
      })
    );
  });

  test("PATCH returns 404 when membership is missing", async () => {
    mocks.prisma.orgMembership.findUnique.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/org/users/user-2", {
        method: "PATCH",
        body: JSON.stringify({ roleName: SYSTEM_ROLE_NAMES.ADMIN }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(404);
  });

  test("PATCH returns 404 when target role does not exist", async () => {
    mocks.prisma.orgMembership.findUnique.mockResolvedValue({
      id: "membership-1",
      roleId: "role-member",
      role: { id: "role-member", name: SYSTEM_ROLE_NAMES.MEMBER },
    });
    mocks.prisma.orgRole.findFirst.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/org/users/user-2", {
        method: "PATCH",
        body: JSON.stringify({ roleName: "Unknown" }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(404);
  });

  test("PATCH prevents removing the last owner", async () => {
    mocks.prisma.orgMembership.findUnique.mockResolvedValue({
      id: "membership-1",
      roleId: "role-owner",
      role: { id: "role-owner", name: SYSTEM_ROLE_NAMES.OWNER },
    });
    mocks.prisma.orgRole.findFirst.mockResolvedValue({
      id: "role-admin",
      name: SYSTEM_ROLE_NAMES.ADMIN,
    });
    mocks.prisma.orgRole.findUnique.mockResolvedValue({ id: "role-owner" });
    mocks.prisma.orgMembership.count.mockResolvedValue(1);

    const response = await PATCH(
      new Request("http://localhost/api/org/users/user-2", {
        method: "PATCH",
        body: JSON.stringify({ roleId: "role-admin" }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.prisma.orgMembership.update).not.toHaveBeenCalled();
  });

  test("PATCH updates membership and legacy user role", async () => {
    mocks.prisma.orgMembership.findUnique.mockResolvedValue({
      id: "membership-1",
      roleId: "role-member",
      role: { id: "role-member", name: SYSTEM_ROLE_NAMES.MEMBER },
    });
    mocks.prisma.orgRole.findFirst.mockResolvedValue({
      id: "role-admin",
      name: SYSTEM_ROLE_NAMES.ADMIN,
    });
    mocks.prisma.orgRole.findUnique.mockResolvedValue({ id: "role-owner" });

    const response = await PATCH(
      new Request("http://localhost/api/org/users/user-2", {
        method: "PATCH",
        body: JSON.stringify({ roleName: SYSTEM_ROLE_NAMES.ADMIN }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.orgMembership.update).toHaveBeenCalledWith({
      where: { id: "membership-1" },
      data: { roleId: "role-admin" },
    });
    expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-2", orgId: "org-1" },
      data: { role: "ADMIN" },
    });
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
  });

  test("DELETE returns 404 when target membership is missing", async () => {
    mocks.prisma.orgMembership.findUnique.mockResolvedValue(null);
    mocks.prisma.orgRole.findUnique.mockResolvedValue({ id: "role-owner" });

    const response = await DELETE(
      new Request("http://localhost/api/org/users/user-2", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(404);
  });

  test("DELETE removes membership and resets user org data", async () => {
    mocks.prisma.orgMembership.findUnique.mockResolvedValue({
      id: "membership-1",
      role: { name: SYSTEM_ROLE_NAMES.MEMBER },
    });
    mocks.prisma.orgRole.findUnique.mockResolvedValue({ id: "role-owner" });
    mocks.prisma.orgMembership.count.mockResolvedValue(2);

    const response = await DELETE(
      new Request("http://localhost/api/org/users/user-2", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.orgMembership.delete).toHaveBeenCalledWith({
      where: { id: "membership-1" },
    });
    expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-2", orgId: "org-1" },
      data: { orgId: null, role: "USER" },
    });
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
  });
});
