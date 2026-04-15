import { beforeEach, describe, expect, test, vi } from "vitest";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

const state = vi.hoisted(() => ({
  orgId: "org-1",
  userId: "user-1",
  perms: new Set<string>(),
  makeError: (status: number, code: string, message: string) => ({
    status,
    code,
    message,
  }),
}));

const mocks = vi.hoisted(() => ({
  prisma: {
    organization: {
      update: vi.fn(async (args: any) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
  } as any,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: state.userId,
      orgId: state.orgId,
    },
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

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));

import { PATCH } from "@/app/api/org/route";

describe("org route PATCH", () => {
  beforeEach(() => {
    state.perms.clear();
    vi.clearAllMocks();
  });

  test("allows settings-only updates with settings permission", async () => {
    state.perms.add(ORG_PERMISSIONS.ORG_SETTINGS_UPDATE);

    const response = await PATCH(
      new Request("http://localhost/api/org", {
        method: "PATCH",
        body: JSON.stringify({
          name: "New Org Name",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        name: "New Org Name",
        budget: undefined,
        settings: undefined,
      },
    });
  });

  test("allows budget-only updates with limits permission", async () => {
    state.perms.add(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);

    const response = await PATCH(
      new Request("http://localhost/api/org", {
        method: "PATCH",
        body: JSON.stringify({
          budget: 1200,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        name: undefined,
        budget: 1200,
        settings: undefined,
      },
    });
  });

  test("requires both permissions when settings and budget are changed together", async () => {
    state.perms.add(ORG_PERMISSIONS.ORG_SETTINGS_UPDATE);

    const response = await PATCH(
      new Request("http://localhost/api/org", {
        method: "PATCH",
        body: JSON.stringify({
          name: "New Org Name",
          budget: 1200,
          settings: {
            theme: "dark",
          },
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.prisma.organization.update).not.toHaveBeenCalled();
  });
});
