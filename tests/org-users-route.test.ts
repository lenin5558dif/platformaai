import { beforeEach, describe, expect, test, vi } from "vitest";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";

const state = vi.hoisted(() => ({
  orgId: "org-1",
  userId: "user-1",
  perms: new Set<string>(),
  existingUser: null as null | {
    id: string;
    orgId: string | null;
    role: "USER" | "ADMIN" | "EMPLOYEE";
  },
  makeError: (status: number, code: string, message: string) => ({
    status,
    code,
    message,
  }),
}));

const mocks = vi.hoisted(() => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () =>
        state.existingUser
          ? {
              ...state.existingUser,
            }
          : null
      ),
      update: vi.fn(async (args: any) => ({
        id: args.where.id,
        email: "invitee@example.com",
        role: args.data.role ?? "EMPLOYEE",
      })),
      create: vi.fn(async (args: any) => ({
        id: "user-new",
        email: args.data.email,
        role: args.data.role,
      })),
    },
    orgMembership: {
      upsert: vi.fn(async (args: any) => ({
        id: "membership-1",
        ...args.create,
      })),
    },
  } as any,
  ensureOrgSystemRolesAndPermissions: vi.fn(async () => ({
    rolesByName: new Map([
      [
        SYSTEM_ROLE_NAMES.ADMIN,
        {
          id: "role-admin",
          name: SYSTEM_ROLE_NAMES.ADMIN,
        },
      ],
      [
        SYSTEM_ROLE_NAMES.MEMBER,
        {
          id: "role-member",
          name: SYSTEM_ROLE_NAMES.MEMBER,
        },
      ],
    ]),
  })),
}));

vi.mock("@/lib/authorize", () => ({
  requireSession: vi.fn(async () => ({
    user: { id: state.userId, orgId: state.orgId },
  })),
  createAuthorizer: vi.fn(() => ({
    requireOrgMembership: vi.fn(async () => ({
      orgId: state.orgId,
      permissionKeys: state.perms,
    })),
    requireOrgPermission: vi.fn(async (permissionKey: string) => {
      if (!state.perms.has(permissionKey)) {
        throw state.makeError(403, "FORBIDDEN", "Forbidden");
      }
      return {
        orgId: state.orgId,
        permissionKeys: state.perms,
      };
    }),
  })),
  toErrorResponse: (error: any) =>
    new Response(
      JSON.stringify({
        error: error?.message ?? "Internal error",
        code: error?.code ?? "INTERNAL",
      }),
      {
        status: error?.status ?? 500,
        headers: {
          "content-type": "application/json",
        },
      }
    ),
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/org-rbac", () => ({
  ensureOrgSystemRolesAndPermissions: mocks.ensureOrgSystemRolesAndPermissions,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/org/users/route";

describe("org users route", () => {
  beforeEach(() => {
    state.perms.clear();
    state.existingUser = null;
    vi.clearAllMocks();
  });

  test("rejects ADMIN assignment without role-change permission", async () => {
    state.perms.add(ORG_PERMISSIONS.ORG_USER_MANAGE);

    const response = await POST(
      new Request("http://localhost/api/org/users", {
        method: "POST",
        body: JSON.stringify({
          email: "invitee@example.com",
          role: "ADMIN",
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
    expect(mocks.prisma.orgMembership.upsert).not.toHaveBeenCalled();
  });

  test("keeps regular invites available with user management permission", async () => {
    state.perms.add(ORG_PERMISSIONS.ORG_USER_MANAGE);

    const response = await POST(
      new Request("http://localhost/api/org/users", {
        method: "POST",
        body: JSON.stringify({
          email: "invitee@example.com",
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "invitee@example.com",
        orgId: "org-1",
        role: "EMPLOYEE",
        balance: 0,
      },
    });
    expect(mocks.ensureOrgSystemRolesAndPermissions).toHaveBeenCalledWith("org-1");
    expect(mocks.prisma.orgMembership.upsert).toHaveBeenCalledWith({
      where: {
        orgId_userId: {
          orgId: "org-1",
          userId: "user-new",
        },
      },
      update: {
        roleId: "role-member",
      },
      create: {
        orgId: "org-1",
        userId: "user-new",
        roleId: "role-member",
      },
    });
  });
});
