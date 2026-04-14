import { beforeEach, describe, expect, test, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

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
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
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

import { PATCH } from "@/app/api/org/users/[id]/limits/route";

describe("PATCH /api/org/users/[id]/limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(state.session);
    mocks.createAuthorizer.mockReturnValue({
      requireOrgPermission: vi.fn(async (permission: string) => {
        expect(permission).toBe(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);
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
  });

  test("returns 404 when user is outside the org", async () => {
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/org/users/user-2/limits", {
        method: "PATCH",
        body: JSON.stringify({ dailyLimit: 10 }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(404);
  });

  test("updates limits and serializes decimals to strings", async () => {
    mocks.prisma.user.findFirst.mockResolvedValue({ id: "user-2", orgId: "org-1" });
    mocks.prisma.user.update.mockResolvedValue({
      id: "user-2",
      dailyLimit: { toString: () => "12.5" },
      monthlyLimit: { toString: () => "100.25" },
    });

    const response = await PATCH(
      new Request("http://localhost/api/org/users/user-2/limits", {
        method: "PATCH",
        body: JSON.stringify({ dailyLimit: 12.5, monthlyLimit: 100.25 }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: "user-2",
        dailyLimit: "12.5",
        monthlyLimit: "100.25",
      },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "actor-1",
        targetId: "user-2",
        metadata: {
          dailyLimit: 12.5,
          monthlyLimit: 100.25,
        },
      })
    );
  });

  test("passes null values through to audit payload", async () => {
    mocks.prisma.user.findFirst.mockResolvedValue({ id: "user-2", orgId: "org-1" });
    mocks.prisma.user.update.mockResolvedValue({
      id: "user-2",
      dailyLimit: null,
      monthlyLimit: null,
    });

    const response = await PATCH(
      new Request("http://localhost/api/org/users/user-2/limits", {
        method: "PATCH",
        body: JSON.stringify({ dailyLimit: null, monthlyLimit: null }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: "user-2",
        dailyLimit: null,
        monthlyLimit: null,
      },
    });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: {
        dailyLimit: undefined,
        monthlyLimit: undefined,
      },
      select: {
        id: true,
        dailyLimit: true,
        monthlyLimit: true,
      },
    });
  });
});
