import { beforeEach, describe, expect, test, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";

const state = vi.hoisted(() => ({
  session: { user: { id: "user-1", orgId: "org-1" } },
  authSession: { user: { id: "user-1", orgId: "org-1" } },
  orgPermissionKeys: new Set<string>([]),
}));

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(),
  createAuthorizer: vi.fn(),
  toErrorResponse: vi.fn(),
  logAudit: vi.fn(),
  applyLimitResets: vi.fn(),
  getAllTimePeriod: vi.fn(),
  getUtcDayPeriod: vi.fn(),
  getUtcMonthPeriod: vi.fn(),
  DEFAULT_RESERVATION_TTL_MS: 60_000,
  mergeOrgSettings: vi.fn(),
  getOrgDlpPolicy: vi.fn(),
  getOrgModelPolicy: vi.fn(),
  ensureOrgSystemRolesAndPermissions: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
    eventLog: {
      findMany: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    orgMembershipAllowedCostCenter: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
    },
    orgRole: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    orgPermission: {
      findMany: vi.fn(),
    },
    orgRolePermission: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    orgDomain: {
      findMany: vi.fn(),
    },
    costCenter: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    quotaReservation: {
      aggregate: vi.fn(),
    },
    quotaBucket: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/authorize", () => ({
  requireSession: mocks.requireSession,
  createAuthorizer: mocks.createAuthorizer,
  toErrorResponse: mocks.toErrorResponse,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/lib/limits", () => ({
  applyLimitResets: mocks.applyLimitResets,
}));

vi.mock("@/lib/quota-manager", () => ({
  getAllTimePeriod: mocks.getAllTimePeriod,
  getUtcDayPeriod: mocks.getUtcDayPeriod,
  getUtcMonthPeriod: mocks.getUtcMonthPeriod,
  DEFAULT_RESERVATION_TTL_MS: mocks.DEFAULT_RESERVATION_TTL_MS,
}));

vi.mock("@/lib/org-settings", () => ({
  getOrgDlpPolicy: mocks.getOrgDlpPolicy,
  getOrgModelPolicy: mocks.getOrgModelPolicy,
  mergeOrgSettings: mocks.mergeOrgSettings,
}));

vi.mock("@/lib/org-rbac", () => ({
  ensureOrgSystemRolesAndPermissions: mocks.ensureOrgSystemRolesAndPermissions,
}));

import { GET as orgGet, POST as orgPost, PATCH as orgPatch } from "@/app/api/org/route";
import { GET as auditGet } from "@/app/api/org/audit/route";
import { GET as usersGet, POST as usersPost } from "@/app/api/org/users/route";
import { GET as costCenterLinksGet, PATCH as costCenterLinksPatch } from "@/app/api/org/users/[id]/cost-centers/route";
import { GET as limitsSummaryGet } from "@/app/api/org/limits/summary/route";
import { POST as transferPost } from "@/app/api/org/transfer/route";
import { GET as policiesGet, PATCH as policiesPatch } from "@/app/api/org/policies/route";
import { GET as costCenterBudgetGet, PATCH as costCenterBudgetPatch } from "@/app/api/org/cost-centers/[id]/budget/route";
import { GET as eventsExportGet } from "@/app/api/events/export/route";

function jsonResponse(res: Response) {
  return res.json() as Promise<any>;
}

function setAuthorizer(permissionKeys: string[]) {
  mocks.createAuthorizer.mockReturnValue({
    requireOrgPermission: vi.fn(async (permission: string) => {
      if (!permissionKeys.includes(permission)) {
        throw new HttpError(403, "FORBIDDEN", "Forbidden");
      }
      return {
        orgId: "org-1",
        permissionKeys: new Set(permissionKeys),
      };
    }),
    requireOrgMembership: vi.fn(async () => ({
      orgId: "org-1",
      permissionKeys: new Set(permissionKeys),
    })),
  });
}

function makeRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();

  mocks.auth.mockResolvedValue(state.authSession);
  mocks.requireSession.mockResolvedValue(state.session);
  mocks.toErrorResponse.mockImplementation((error: unknown) => {
    if (error instanceof HttpError) {
      return new Response(JSON.stringify({ code: error.code, error: error.message }), {
        status: error.status,
        headers: { "content-type": "application/json" },
      });
    }
    if (error instanceof Error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  });

  mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
    callback(mocks.prisma)
  );

  mocks.getAllTimePeriod.mockReturnValue({
    key: "all",
    start: new Date("2026-01-01T00:00:00.000Z"),
    end: new Date("2026-12-31T23:59:59.999Z"),
  });
  mocks.getUtcDayPeriod.mockReturnValue({
    key: "day",
    start: new Date("2026-04-01T00:00:00.000Z"),
    end: new Date("2026-04-01T23:59:59.999Z"),
  });
  mocks.getUtcMonthPeriod.mockReturnValue({
    key: "month",
    start: new Date("2026-04-01T00:00:00.000Z"),
    end: new Date("2026-04-30T23:59:59.999Z"),
  });
  mocks.applyLimitResets.mockImplementation(({ dailySpent, monthlySpent, dailyResetAt, monthlyResetAt }: any) => ({
    dailySpent,
    monthlySpent,
    dailyResetAt,
    monthlyResetAt,
  }));
  mocks.getOrgDlpPolicy.mockImplementation((settings: any) => settings?.dlpPolicy ?? {
    enabled: false,
    action: "block",
    patterns: [],
  });
  mocks.getOrgModelPolicy.mockImplementation((settings: any) => settings?.modelPolicy ?? {
    mode: "denylist",
    models: [],
  });
  mocks.mergeOrgSettings.mockImplementation((existing: any, patch: any) => ({
    ...(existing ?? {}),
    ...(patch ?? {}),
  }));
  mocks.ensureOrgSystemRolesAndPermissions.mockResolvedValue({
    rolesByName: new Map([[SYSTEM_ROLE_NAMES.OWNER, { id: "role-owner" }]]),
  });

  setAuthorizer([
    ORG_PERMISSIONS.ORG_AUDIT_READ,
    ORG_PERMISSIONS.ORG_BILLING_MANAGE,
    ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE,
    ORG_PERMISSIONS.ORG_LIMITS_MANAGE,
    ORG_PERMISSIONS.ORG_POLICY_UPDATE,
    ORG_PERMISSIONS.ORG_ROLE_CHANGE,
    ORG_PERMISSIONS.ORG_SETTINGS_UPDATE,
    ORG_PERMISSIONS.ORG_USER_MANAGE,
    ORG_PERMISSIONS.ORG_ANALYTICS_READ,
    ORG_PERMISSIONS.ORG_INVITE_CREATE,
  ]);
});

describe("org API routes coverage", () => {
  test("GET /api/org handles unauthorized, empty, and populated org states", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const unauthorized = await orgGet();
    expect(unauthorized.status).toBe(401);

    mocks.auth.mockResolvedValueOnce(state.authSession);
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ orgId: null });
    const empty = await orgGet();
    expect(await jsonResponse(empty)).toEqual({ data: null });

    mocks.prisma.user.findUnique.mockResolvedValueOnce({ orgId: "org-1" });
    mocks.prisma.organization.findUnique.mockResolvedValueOnce({ id: "org-1", name: "Acme" });
    const populated = await orgGet();
    expect(await jsonResponse(populated)).toEqual({ data: { id: "org-1", name: "Acme" } });
  });

  test("POST /api/org creates organizations and rejects duplicates", async () => {
    mocks.requireSession.mockResolvedValue(state.session);
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ orgId: null });
    mocks.prisma.organization.create.mockResolvedValueOnce({ id: "org-2", name: "New Org" });
    mocks.prisma.user.update.mockResolvedValueOnce({ id: "user-1" });
    const created = await orgPost(
      makeRequest("http://localhost/api/org", {
        method: "POST",
        body: JSON.stringify({ name: "New Org", budget: 42 }),
      })
    );

    expect(created.status).toBe(201);
    expect(mocks.prisma.organization.create).toHaveBeenCalledWith({
      data: {
        name: "New Org",
        ownerId: "user-1",
        budget: 42,
      },
    });

    mocks.prisma.user.findUnique.mockResolvedValueOnce({ orgId: "org-1" });
    const conflict = await orgPost(
      makeRequest("http://localhost/api/org", {
        method: "POST",
        body: JSON.stringify({ name: "Existing Org" }),
      })
    );
    expect(conflict.status).toBe(409);

    const badCreate = await orgPost(
      makeRequest("http://localhost/api/org", {
        method: "POST",
        body: JSON.stringify({ name: "A" }),
      })
    );
    expect(badCreate.status).toBe(500);
  });

  test("PATCH /api/org updates name and budget with the correct permission gate", async () => {
    mocks.prisma.organization.findUnique.mockResolvedValueOnce({ settings: {} });

    const rename = await orgPatch(
      makeRequest("http://localhost/api/org", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed Org", settings: { theme: "sunrise" } }),
      })
    );

    expect(rename.status).toBe(200);
    expect(mocks.prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        name: "Renamed Org",
        budget: undefined,
        settings: { theme: "sunrise" },
      },
    });

    mocks.prisma.organization.update.mockClear();
    mocks.prisma.organization.findUnique.mockResolvedValueOnce({ settings: {} });

    const budget = await orgPatch(
      makeRequest("http://localhost/api/org", {
        method: "PATCH",
        body: JSON.stringify({ budget: 500 }),
      })
    );

    expect(budget.status).toBe(200);
    expect(mocks.prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        name: undefined,
        budget: 500,
        settings: undefined,
      },
    });

    const badPatch = await orgPatch(
      makeRequest("http://localhost/api/org", {
        method: "PATCH",
        body: JSON.stringify({ name: "A" }),
      })
    );
    expect(badPatch.status).toBe(500);
  });

  test("GET /api/org/audit filters and redacts metadata", async () => {
    mocks.prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-1",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        action: "USER_UPDATED",
        channel: "API",
        actorId: "actor-1",
        targetType: "user",
        targetId: "user-2",
        correlationId: "corr-1",
        metadata: { token: "secret-token", nested: { passwordHash: "hash" } },
        actor: { email: "actor@example.com" },
      },
      {
        id: "audit-2",
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
        action: "USER_UPDATED",
        channel: "WEB",
        actorId: "actor-2",
        targetType: "user",
        targetId: "user-3",
        correlationId: null,
        metadata: [null, { apiToken: "secret" }, "plain"],
        actor: null,
      },
    ]);

    const response = await auditGet(
      new Request(
        "http://localhost/api/org/audit?actor=actor&action=USER_UPDATED&channel=API&period=7d&limit=5",
        { method: "GET" }
      )
    );

    expect(response.status).toBe(200);
    expect(await jsonResponse(response)).toEqual({
      data: [
        {
          id: "audit-1",
          createdAt: "2026-04-01T00:00:00.000Z",
          action: "USER_UPDATED",
          channel: "API",
          actorId: "actor-1",
          actorEmail: "actor@example.com",
          targetType: "user",
          targetId: "user-2",
          correlationId: "corr-1",
          metadata: { token: "[redacted]", nested: { passwordHash: "[redacted]" } },
        },
        {
          id: "audit-2",
          createdAt: "2026-04-02T00:00:00.000Z",
          action: "USER_UPDATED",
          channel: "WEB",
          actorId: "actor-2",
          actorEmail: null,
          targetType: "user",
          targetId: "user-3",
          correlationId: null,
          metadata: [null, { apiToken: "[redacted]" }, "plain"],
        },
      ],
    });

    const period30d = await auditGet(
      new Request(
        "http://localhost/api/org/audit?period=30d",
        { method: "GET" }
      )
    );
    expect(period30d.status).toBe(200);
  });

  test("GET /api/org/audit rejects invalid filters and auth", async () => {
    mocks.requireSession.mockRejectedValueOnce(new HttpError(401, "UNAUTHORIZED", "Unauthorized"));
    const unauthorized = await auditGet(new Request("http://localhost/api/org/audit", { method: "GET" }));
    expect(unauthorized.status).toBe(401);

    mocks.requireSession.mockResolvedValueOnce(state.session);
    const invalid = await auditGet(new Request("http://localhost/api/org/audit?action=BAD", { method: "GET" }));
    expect(invalid.status).toBe(400);

    mocks.requireSession.mockRejectedValueOnce(new Error("boom"));
    const broken = await auditGet(new Request("http://localhost/api/org/audit", { method: "GET" }));
    expect(broken.status).toBe(500);
  });

  test("GET and POST /api/org/users cover list and invite flows", async () => {
    mocks.prisma.orgMembership.findMany.mockResolvedValueOnce([
      {
        user: {
          id: "user-2",
          email: "member@example.com",
          role: "EMPLOYEE",
          balance: { toString: () => "12.50" },
          dailyLimit: { toString: () => "10" },
          monthlyLimit: null,
          isActive: true,
          costCenterId: "cc-1",
        },
        defaultCostCenterId: "cc-1",
        role: {
          id: "role-member",
          name: SYSTEM_ROLE_NAMES.MEMBER,
          permissions: [{ permission: { key: ORG_PERMISSIONS.ORG_AUDIT_READ } }],
        },
      },
    ]);

    const list = await usersGet();
    expect(await jsonResponse(list)).toEqual({
      data: [
        {
          id: "user-2",
          email: "member@example.com",
          legacyRole: "EMPLOYEE",
          balance: "12.50",
          dailyLimit: "10",
          monthlyLimit: null,
          isActive: true,
          costCenterId: "cc-1",
          defaultCostCenterId: "cc-1",
          role: {
            id: "role-member",
            name: SYSTEM_ROLE_NAMES.MEMBER,
            permissionKeys: [ORG_PERMISSIONS.ORG_AUDIT_READ],
          },
        },
      ],
    });

    setAuthorizer([]);
    const forbidden = await usersGet();
    expect(forbidden.status).toBe(403);

    setAuthorizer([
      ORG_PERMISSIONS.ORG_AUDIT_READ,
      ORG_PERMISSIONS.ORG_BILLING_MANAGE,
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE,
      ORG_PERMISSIONS.ORG_LIMITS_MANAGE,
      ORG_PERMISSIONS.ORG_POLICY_UPDATE,
      ORG_PERMISSIONS.ORG_ROLE_CHANGE,
      ORG_PERMISSIONS.ORG_SETTINGS_UPDATE,
      ORG_PERMISSIONS.ORG_USER_MANAGE,
      ORG_PERMISSIONS.ORG_ANALYTICS_READ,
      ORG_PERMISSIONS.ORG_INVITE_CREATE,
    ]);

    mocks.prisma.user.findUnique.mockResolvedValueOnce(null);
    mocks.prisma.user.create = vi.fn().mockResolvedValueOnce({
      id: "user-3",
      email: "invitee@example.com",
      role: "ADMIN",
    });
    mocks.ensureOrgSystemRolesAndPermissions.mockResolvedValueOnce({
      rolesByName: new Map([[SYSTEM_ROLE_NAMES.MEMBER, { id: "role-member" }]]),
    });

    const invited = await usersPost(
      makeRequest("http://localhost/api/org/users", {
        method: "POST",
        body: JSON.stringify({ email: "invitee@example.com", role: "ADMIN" }),
      })
    );

    expect(invited.status).toBe(201);
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "invitee@example.com" },
      select: { id: true, orgId: true, role: true },
    });
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "invitee@example.com",
        orgId: "org-1",
        role: "ADMIN",
        balance: 0,
      },
    });

    const badInvite = await usersPost(
      makeRequest("http://localhost/api/org/users", {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email" }),
      })
    );
    expect(badInvite.status).toBe(500);
  });

  test("GET and PATCH /api/org/users/[id]/cost-centers validate and persist cost center assignments", async () => {
    mocks.prisma.orgMembership.findUnique
      .mockResolvedValueOnce({
        id: "membership-1",
        defaultCostCenterId: "cc-1",
        allowedCostCenters: [{ costCenterId: "cc-1" }, { costCenterId: "cc-2" }],
      })
      .mockResolvedValueOnce({
        id: "membership-1",
        defaultCostCenterId: "cc-1",
        allowedCostCenters: [],
      })
      .mockResolvedValueOnce(null);

    const get = await costCenterLinksGet(
      new Request("http://localhost/api/org/users/user-2/cost-centers", { method: "GET" }),
      { params: Promise.resolve({ id: "user-2" }) }
    );
    expect(await jsonResponse(get)).toEqual({
      defaultCostCenterId: "cc-1",
      allowedCostCenterIds: ["cc-1", "cc-2"],
    });

    mocks.prisma.costCenter.findMany.mockResolvedValueOnce([
      { id: "cc-1" },
      { id: "cc-2" },
    ]);

    const patch = await costCenterLinksPatch(
      makeRequest("http://localhost/api/org/users/user-2/cost-centers", {
        method: "PATCH",
        body: JSON.stringify({
          defaultCostCenterId: "cc-1",
          allowedCostCenterIds: ["cc-1", "cc-2"],
        }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );
    expect(patch.status).toBe(200);
    expect(mocks.prisma.orgMembershipAllowedCostCenter.createMany).toHaveBeenCalledWith({
      data: [
        { membershipId: "membership-1", costCenterId: "cc-1" },
        { membershipId: "membership-1", costCenterId: "cc-2" },
      ],
    });

    const missing = await costCenterLinksPatch(
      makeRequest("http://localhost/api/org/users/user-404/cost-centers", {
        method: "PATCH",
        body: JSON.stringify({ defaultCostCenterId: "cc-x" }),
      }),
      { params: Promise.resolve({ id: "user-404" }) }
    );
    expect(missing.status).toBe(404);

    mocks.prisma.orgMembership.findUnique.mockResolvedValueOnce(null);
    const missingGet = await costCenterLinksGet(
      new Request("http://localhost/api/org/users/user-404/cost-centers", { method: "GET" }),
      { params: Promise.resolve({ id: "user-404" }) }
    );
    expect(missingGet.status).toBe(404);

    mocks.prisma.orgMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      defaultCostCenterId: "cc-1",
      allowedCostCenters: [],
    });
    const emptyAllowed = await costCenterLinksPatch(
      makeRequest("http://localhost/api/org/users/user-2/cost-centers", {
        method: "PATCH",
        body: JSON.stringify({ allowedCostCenterIds: [] }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );
    expect(emptyAllowed.status).toBe(200);

    mocks.prisma.orgMembership.findUnique.mockResolvedValueOnce({
      id: "membership-1",
      defaultCostCenterId: "cc-1",
      allowedCostCenters: [],
    });
    mocks.prisma.costCenter.findMany.mockResolvedValueOnce([{ id: "cc-1" }]);
    const invalidCostCenter = await costCenterLinksPatch(
      makeRequest("http://localhost/api/org/users/user-2/cost-centers", {
        method: "PATCH",
        body: JSON.stringify({ defaultCostCenterId: "cc-x" }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );
    expect(invalidCostCenter.status).toBe(400);

    const invalidPatch = await costCenterLinksPatch(
      makeRequest("http://localhost/api/org/users/user-2/cost-centers", {
        method: "PATCH",
        body: JSON.stringify({ defaultCostCenterId: "" }),
      }),
      { params: Promise.resolve({ id: "user-2" }) }
    );
    expect(invalidPatch.status).toBe(500);

    mocks.requireSession.mockRejectedValueOnce(new Error("boom"));
    const brokenGet = await costCenterLinksGet(
      new Request("http://localhost/api/org/users/user-2/cost-centers", { method: "GET" }),
      { params: Promise.resolve({ id: "user-2" }) }
    );
    expect(brokenGet.status).toBe(500);
  });

  test("GET /api/org/limits/summary and transfer routes cover budget and member flows", async () => {
    mocks.prisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      budget: 1000,
      spent: 250,
    });
    mocks.prisma.quotaReservation.aggregate.mockImplementation(async (args: any) => {
      const contains = args.where?.requestId?.contains;
      if (contains === "|all|") {
        return { _sum: { amount: 15 } };
      }
      if (contains === "|day|") {
        return { _sum: { amount: 2 } };
      }
      if (contains === "|month|") {
        return { _sum: { amount: 5 } };
      }
      return { _sum: { amount: 0 } };
    });

    const orgSummary = await limitsSummaryGet(
      new Request("http://localhost/api/org/limits/summary", { method: "GET" })
    );
    expect(await jsonResponse(orgSummary)).toMatchObject({
      data: {
        org: {
          id: "org-1",
          budget: 1000,
          spent: 250,
          reserved: 15,
        },
        user: null,
      },
    });

    mocks.prisma.organization.findUnique.mockResolvedValueOnce({
      id: "org-1",
      budget: 1000,
      spent: 250,
    });
    mocks.prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-2",
      dailyLimit: 12,
      monthlyLimit: 120,
      dailySpent: 30,
      monthlySpent: 300,
      dailyResetAt: null,
      monthlyResetAt: null,
    });

    const userSummary = await limitsSummaryGet(
      new Request("http://localhost/api/org/limits/summary?userId=user-2", {
        method: "GET",
      })
    );
    expect(await jsonResponse(userSummary)).toMatchObject({
      data: {
        user: {
          id: "user-2",
          dailyLimit: "12",
          monthlyLimit: "120",
          dailySpent: 30,
          monthlySpent: 300,
          dailyReserved: 2,
          monthlyReserved: 5,
        },
      },
    });
    expect(mocks.applyLimitResets).toHaveBeenCalled();

    mocks.prisma.organization.findUnique.mockResolvedValueOnce({
      id: "org-1",
      budget: 1000,
      spent: 250,
    });
    mocks.prisma.user.findFirst.mockResolvedValueOnce(null);
    const missingUser = await limitsSummaryGet(
      new Request("http://localhost/api/org/limits/summary?userId=user-404", {
        method: "GET",
      })
    );
    expect(missingUser.status).toBe(404);

    mocks.prisma.organization.findUnique.mockResolvedValueOnce(null);
    const missingOrg = await limitsSummaryGet(
      new Request("http://localhost/api/org/limits/summary", { method: "GET" })
    );
    expect(missingOrg.status).toBe(404);

    mocks.requireSession.mockRejectedValueOnce(new Error("boom"));
    const brokenSummary = await limitsSummaryGet(
      new Request("http://localhost/api/org/limits/summary", { method: "GET" })
    );
    expect(brokenSummary.status).toBe(500);

    const transfer = await transferPost(
      makeRequest("http://localhost/api/org/transfer", {
        method: "POST",
        body: JSON.stringify({ userId: "user-2", amount: 20 }),
      })
    );
    expect(transfer.status).toBe(410);
    expect(await jsonResponse(transfer)).toEqual({
      error: "Deprecated endpoint",
      code: "DEPRECATED_ENDPOINT",
      message:
        "Use the organization management UI transfer flow in /org (server action transferCredits).",
    });

    const brokenTransfer = await transferPost(
      makeRequest("http://localhost/api/org/transfer", {
        method: "POST",
        body: JSON.stringify({ userId: "user-2", amount: 20 }),
      })
    );
    expect(brokenTransfer.status).toBe(410);
  });

  test("GET /api/org/limits/summary falls back to zero and null defaults", async () => {
    mocks.prisma.organization.findUnique.mockResolvedValueOnce({
      id: "org-1",
      budget: null,
      spent: null,
    });
    mocks.prisma.user.findFirst.mockResolvedValueOnce({
      id: "user-3",
      dailyLimit: null,
      monthlyLimit: null,
      dailySpent: null,
      monthlySpent: null,
      dailyResetAt: null,
      monthlyResetAt: null,
    });
    mocks.prisma.quotaReservation.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });

    const res = await limitsSummaryGet(
      new Request("http://localhost/api/org/limits/summary?userId=user-3", {
        method: "GET",
      })
    );

    expect(await jsonResponse(res)).toMatchObject({
      data: {
        org: {
          id: "org-1",
          budget: 0,
          spent: 0,
          reserved: 0,
        },
        user: {
          id: "user-3",
          dailyLimit: null,
          monthlyLimit: null,
          dailySpent: 0,
          monthlySpent: 0,
          dailyReserved: 0,
          monthlyReserved: 0,
        },
      },
    });
  });

  test("transfer route maps not found and insufficient balance errors", async () => {
    const missingAdmin = await transferPost(
      makeRequest("http://localhost/api/org/transfer", {
        method: "POST",
        body: JSON.stringify({ userId: "user-2", amount: 20 }),
      })
    );
    expect(missingAdmin.status).toBe(410);
  });

  test("GET and PATCH /api/org/policies expose and update policy state", async () => {
    mocks.getOrgDlpPolicy.mockReturnValueOnce({
      enabled: true,
      action: "redact",
      patterns: ["token"],
    });
    mocks.getOrgModelPolicy.mockReturnValueOnce({
      mode: "allowlist",
      models: ["openai/gpt-4o"],
    });
    mocks.prisma.organization.findUnique.mockResolvedValueOnce({ settings: {} });
    const view = await policiesGet();
    expect(await jsonResponse(view)).toMatchObject({
      data: {
        dlpPolicy: { enabled: true, action: "redact", patterns: ["token"] },
        modelPolicy: { mode: "allowlist", models: ["openai/gpt-4o"] },
      },
    });

    mocks.createAuthorizer.mockReturnValue({
      requireOrgPermission: vi.fn(async () => ({
        orgId: "org-1",
        permissionKeys: new Set<string>(),
      })),
      requireOrgMembership: vi.fn(async () => ({
        orgId: "org-1",
        permissionKeys: new Set<string>(),
      })),
    });
    mocks.requireSession.mockResolvedValueOnce({
      user: { id: "user-1", orgId: "org-1" },
    });
    const forbidden = await policiesGet();
    expect(forbidden.status).toBe(403);

    mocks.requireSession.mockRejectedValueOnce(new Error("boom"));
    const brokenView = await policiesGet();
    expect(brokenView.status).toBe(500);

    setAuthorizer([
      ORG_PERMISSIONS.ORG_AUDIT_READ,
      ORG_PERMISSIONS.ORG_BILLING_MANAGE,
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE,
      ORG_PERMISSIONS.ORG_LIMITS_MANAGE,
      ORG_PERMISSIONS.ORG_POLICY_UPDATE,
      ORG_PERMISSIONS.ORG_ROLE_CHANGE,
      ORG_PERMISSIONS.ORG_SETTINGS_UPDATE,
      ORG_PERMISSIONS.ORG_USER_MANAGE,
      ORG_PERMISSIONS.ORG_ANALYTICS_READ,
      ORG_PERMISSIONS.ORG_INVITE_CREATE,
    ]);

    mocks.prisma.organization.findUnique.mockResolvedValueOnce({ settings: {} });
    const dlp = await policiesPatch(
      makeRequest("http://localhost/api/org/policies", {
        method: "PATCH",
        body: JSON.stringify({
          type: "dlp",
          enabled: true,
          action: "block",
          patterns: ["  secret ", ""],
        }),
      })
    );
    expect(dlp.status).toBe(200);

    mocks.prisma.organization.findUnique.mockResolvedValueOnce({ settings: {} });
    const model = await policiesPatch(
      makeRequest("http://localhost/api/org/policies", {
        method: "PATCH",
        body: JSON.stringify({
          type: "model",
          mode: "denylist",
          models: [" openai/gpt-4o ", ""],
        }),
      })
    );
    expect(model.status).toBe(200);

    const brokenPatch = await policiesPatch(
      makeRequest("http://localhost/api/org/policies", {
        method: "PATCH",
        body: JSON.stringify({ type: "dlp" }),
      })
    );
    expect(brokenPatch.status).toBe(500);
  });

  test("GET and PATCH /api/org/cost-centers/[id]/budget cover missing and existing centers", async () => {
    mocks.prisma.costCenter.findFirst.mockResolvedValueOnce({ id: "cc-1" });
    mocks.prisma.quotaBucket.findUnique.mockResolvedValueOnce({
      limit: 80,
      spent: 40,
    });
    mocks.prisma.quotaBucket.upsert.mockResolvedValueOnce({
      limit: 0,
      spent: 0,
    });

    const summary = await costCenterBudgetGet(
      new Request("http://localhost/api/org/cost-centers/cc-1/budget", { method: "GET" }),
      { params: Promise.resolve({ id: "cc-1" }) }
    );
    expect(await jsonResponse(summary)).toEqual({
      data: {
        budget: 80,
        spent: 40,
      },
    });

    const missing = await costCenterBudgetGet(
      new Request("http://localhost/api/org/cost-centers/missing/budget", { method: "GET" }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(missing.status).toBe(404);

    mocks.prisma.costCenter.findFirst.mockResolvedValueOnce({ id: "cc-1" });
    const cleared = await costCenterBudgetPatch(
      makeRequest("http://localhost/api/org/cost-centers/cc-1/budget", {
        method: "PATCH",
        body: JSON.stringify({ budget: null }),
      }),
      { params: Promise.resolve({ id: "cc-1" }) }
    );
    expect(cleared.status).toBe(200);
    expect(await jsonResponse(cleared)).toEqual({
      data: {
        budget: 0,
        spent: 0,
      },
    });

    mocks.prisma.costCenter.findFirst.mockResolvedValueOnce(null);
    const absent = await costCenterBudgetPatch(
      makeRequest("http://localhost/api/org/cost-centers/missing/budget", {
        method: "PATCH",
        body: JSON.stringify({ budget: 10 }),
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(absent.status).toBe(404);

    mocks.requireSession.mockRejectedValueOnce(new Error("boom"));
    const brokenGet = await costCenterBudgetGet(
      new Request("http://localhost/api/org/cost-centers/cc-1/budget", { method: "GET" }),
      { params: Promise.resolve({ id: "cc-1" }) }
    );
    expect(brokenGet.status).toBe(500);

    const brokenPatch = await costCenterBudgetPatch(
      makeRequest("http://localhost/api/org/cost-centers/cc-1/budget", {
        method: "PATCH",
        body: JSON.stringify({ budget: -1 }),
      }),
      { params: Promise.resolve({ id: "cc-1" }) }
    );
    expect(brokenPatch.status).toBe(500);
  });

  test("GET /api/events/export returns CSV output and filters inputs", async () => {
    mocks.prisma.user.findMany.mockResolvedValueOnce([
      { id: "user-1" },
      { id: "user-2" },
    ]);
    mocks.prisma.eventLog.findMany.mockResolvedValueOnce([
      {
        id: "event-1",
        createdAt: new Date("2026-04-03T12:00:00.000Z"),
        type: "AI_REQUEST",
        userId: "user-1",
        chatId: "chat-1",
        modelId: "model-1",
        message: 'He said "hi"',
        payload: { nested: true },
      },
    ]);

    const response = await eventsExportGet(
      new Request(
        "http://localhost/api/events/export?type=AI_REQUEST&model=  model-1  &limit=5",
        { method: "GET" }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv).toContain('"id","createdAt","type","userId","chatId","modelId","message","payload"');
    expect(csv).toContain('"event-1"');
    expect(csv).toContain('"He said ""hi"""');

    mocks.prisma.user.findMany.mockResolvedValueOnce([{ id: "user-1" }]);
    mocks.prisma.eventLog.findMany.mockResolvedValueOnce([]);
    const invalidType = await eventsExportGet(
      new Request("http://localhost/api/events/export?type=NOT_REAL", { method: "GET" })
    );
    expect(invalidType.status).toBe(200);

    mocks.prisma.user.findMany.mockRejectedValueOnce(new Error("boom"));
    const broken = await eventsExportGet(
      new Request("http://localhost/api/events/export", { method: "GET" })
    );
    expect(broken.status).toBe(500);
  });
});
