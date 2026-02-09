import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionActive: true,
  membershipKeys: new Set<string>(["org:user.manage"]),
  targetUserInOrg: true,
}));

const session = {
  user: {
    id: "user_1",
    orgId: "org_1",
  },
} as any;

const prisma = {
  $transaction: vi.fn(async (fn: any) =>
    fn({
      user: {
        update: vi.fn(async () => ({ id: "user_1" })),
      },
      session: {
        deleteMany: vi.fn(async () => {
          state.sessionActive = false;
          return { count: 1 };
        }),
      },
    })
  ),
  user: {
    findFirst: vi.fn(async () => (state.targetUserInOrg ? { id: "target_1" } : null)),
  },
  orgMembership: {
    findUnique: vi.fn(async () => ({
      roleId: "role_1",
      defaultCostCenterId: null,
      role: {
        name: "Role",
        permissions: Array.from(state.membershipKeys).map((key) => ({
          permission: { key },
        })),
      },
    })),
  },
  auditLog: {
    create: vi.fn(async () => ({ id: "audit_1" })),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.sessionActive ? session : null)),
  handlers: {},
}));

describe("session global revoke", () => {
  beforeEach(async () => {
    state.sessionActive = true;
    state.membershipKeys = new Set(["org:user.manage"]);
    state.targetUserInOrg = true;
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test(
    "self revoke invalidates session for subsequent AI and org routes",
    async () => {
    const { POST: revokeAll } = await import("../src/app/api/auth/revoke-all/route");
    const res = await revokeAll(
      new Request("http://localhost/api/auth/revoke-all", { method: "POST" })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.auditLog.create).toHaveBeenCalled();

    const { POST: aiChat } = await import("../src/app/api/ai/chat/route");
    const aiRes = await aiChat(
      new Request("http://localhost/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(aiRes.status).toBe(401);

    const { PATCH: patchLimits } = await import(
      "../src/app/api/org/users/[id]/limits/route"
    );
    const orgRes = await patchLimits(
      new Request("http://localhost/api/org/users/target_1/limits", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyLimit: 1, monthlyLimit: 1 }),
      }),
      { params: Promise.resolve({ id: "target_1" }) }
    );
    expect(orgRes.status).toBe(401);
    },
    15000
  );

  test("admin revoke requires org:user.manage", async () => {
    state.membershipKeys = new Set();

    const { POST: adminRevoke } = await import(
      "../src/app/api/org/users/[id]/revoke-sessions/route"
    );

    const res = await adminRevoke(
      new Request("http://localhost/api/org/users/target_1/revoke-sessions", {
        method: "POST",
      }),
      { params: { id: "target_1" } }
    );

    expect(res.status).toBe(403);
  });

  test("admin revoke requires target user in same org", async () => {
    state.targetUserInOrg = false;

    const { POST: adminRevoke } = await import(
      "../src/app/api/org/users/[id]/revoke-sessions/route"
    );

    const res = await adminRevoke(
      new Request("http://localhost/api/org/users/target_1/revoke-sessions", {
        method: "POST",
      }),
      { params: { id: "target_1" } }
    );

    expect(res.status).toBe(404);
  });

  test("admin revoke writes audit event", async () => {
    const { POST: adminRevoke } = await import(
      "../src/app/api/org/users/[id]/revoke-sessions/route"
    );

    const res = await adminRevoke(
      new Request("http://localhost/api/org/users/target_1/revoke-sessions", {
        method: "POST",
        headers: { "user-agent": "vitest" },
      }),
      { params: { id: "target_1" } }
    );

    expect(res.status).toBe(200);
    expect(prisma.auditLog.create).toHaveBeenCalled();
    const call = prisma.auditLog.create.mock.calls[0]?.[0];
    expect(call?.data?.metadata?.sessionGlobalRevoke?.mode).toBe("ADMIN");
  });
});
