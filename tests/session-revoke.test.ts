import { describe, expect, test, vi } from "vitest";

const tx = {
  user: {
    update: vi.fn(async () => ({ id: "user_1" })),
  },
  session: {
    deleteMany: vi.fn(async () => ({ count: 2 })),
  },
};

const prisma = {
  $transaction: vi.fn(async (fn: any) => fn(tx)),
} as any;

vi.mock("@/lib/db", () => ({ prisma }));

describe("revokeAllSessionsForUser", () => {
  test("sets sessionInvalidatedAt and deletes sessions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-03T12:00:00.000Z"));

    const { revokeAllSessionsForUser } = await import("../src/lib/session-revoke");

    const result = await revokeAllSessionsForUser("user_1");
    expect(result.deletedSessions).toBe(2);
    expect(result.revokedAt.toISOString()).toBe("2026-02-03T12:00:00.000Z");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        sessionInvalidatedAt: new Date("2026-02-03T12:00:00.000Z"),
        globalRevokeCounter: { increment: 1 },
      },
      select: { id: true },
    });
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });

  test("is safe to repeat (idempotent)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-03T12:00:00.000Z"));

    prisma.$transaction.mockClear();
    tx.user.update.mockClear();
    tx.session.deleteMany.mockClear();

    const { revokeAllSessionsForUser } = await import("../src/lib/session-revoke");

    const first = await revokeAllSessionsForUser("user_1");
    expect(first.deletedSessions).toBe(2);

    vi.setSystemTime(new Date("2026-02-03T12:00:01.000Z"));
    const second = await revokeAllSessionsForUser("user_1");
    expect(second.deletedSessions).toBe(2);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.user.update).toHaveBeenCalledTimes(2);
    expect(tx.session.deleteMany).toHaveBeenCalledTimes(2);
  });
});
