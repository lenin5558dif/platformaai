import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  telegramId: "123",
}));

const session = {
  user: {
    id: "user_1",
    orgId: "org_1",
  },
} as any;

const prisma = {
  user: {
    findUnique: vi.fn(async () => ({
      id: "user_1",
      orgId: "org_1",
      telegramId: state.telegramId,
    })),
    update: vi.fn(async () => ({ id: "user_1" })),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? session : null)),
  handlers: {},
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));

describe("telegram unlink route", () => {
  beforeEach(async () => {
    state.authenticated = true;
    state.telegramId = "123";
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("returns 401 if not authenticated", async () => {
    state.authenticated = false;
    const { DELETE } = await import("../src/app/api/telegram/unlink/route");
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test("is idempotent when no binding exists", async () => {
    state.telegramId = null as any;
    const { DELETE } = await import("../src/app/api/telegram/unlink/route");
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(prisma.user.update).not.toHaveBeenCalled();

    const audit = await import("@/lib/audit");
    expect((audit as any).logAudit).not.toHaveBeenCalled();
  });

  test("clears binding and emits audit event", async () => {
    const { DELETE } = await import("../src/app/api/telegram/unlink/route");
    const res = await DELETE();
    expect(res.status).toBe(204);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { telegramId: null },
      select: { id: true },
    });

    const audit = await import("@/lib/audit");
    expect((audit as any).logAudit).toHaveBeenCalled();
    const call = (audit as any).logAudit.mock.calls[0]?.[0];
    expect(call?.action).toBe("TELEGRAM_UNLINKED");
    expect(call?.metadata?.telegram?.action).toBe("unlink");
    expect(call?.metadata?.telegram?.telegramId).toBe("123");
  });
});
