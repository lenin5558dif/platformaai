import { beforeEach, describe, expect, test, vi } from "vitest";
import { getTelegramAccessBlockMessage } from "@/lib/telegram-linking";

const state = vi.hoisted(() => ({
  now: new Date("2026-02-03T12:00:00.000Z"),
  user: {
    id: "user_1",
    orgId: "org_1",
    email: "u@example.com",
    isActive: true,
    telegramId: null as string | null,
    globalRevokeCounter: 0,
  },
  tokenRecords: new Map<string, any>(),
}));

function makeToken(id: string) {
  return {
    id,
    token: "prefix",
    telegramLinkTokenHash: "hash",
    userId: state.user.id,
    usedAt: null,
    expiresAt: new Date(state.now.getTime() + 10 * 60 * 1000),
    user: { id: state.user.id, orgId: state.user.orgId, email: state.user.email },
  };
}

const prisma = {
  $transaction: vi.fn(async (fn: any) =>
    fn({
      user: {
        update: vi.fn(async (args: any) => {
          if (args.data?.globalRevokeCounter?.increment) {
            state.user.globalRevokeCounter += args.data.globalRevokeCounter.increment;
          }
          if (Object.prototype.hasOwnProperty.call(args.data ?? {}, "sessionInvalidatedAt")) {
            // ignore
          }
          return { id: state.user.id };
        }),
      },
      session: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    })
  ),
  telegramLinkToken: {
    findUnique: vi.fn(async (args: any) => state.tokenRecords.get(args.where.id) ?? null),
    update: vi.fn(async (args: any) => {
      const rec = state.tokenRecords.get(args.where.id);
      if (!rec) throw new Error("NOT_FOUND");
      Object.assign(rec, args.data);
      state.tokenRecords.set(rec.id, rec);
      return { id: rec.id };
    }),
  },
  user: {
    findUnique: vi.fn(async (args: any) => {
      if (args.where?.telegramId) {
        if (state.user.telegramId && state.user.telegramId === args.where.telegramId) {
          return { id: state.user.id };
        }
        return null;
      }
      return null;
    }),
    update: vi.fn(async (args: any) => {
      if (Object.prototype.hasOwnProperty.call(args.data ?? {}, "telegramId")) {
        state.user.telegramId = args.data.telegramId;
      }
      if (Object.prototype.hasOwnProperty.call(args.data ?? {}, "globalRevokeCounter")) {
        state.user.globalRevokeCounter = args.data.globalRevokeCounter;
      }
      return { id: state.user.id };
    }),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));

describe("telegram global revoke parity (e2e)", () => {
  beforeEach(async () => {
    state.user.telegramId = null;
    state.user.globalRevokeCounter = 0;
    state.tokenRecords.clear();
    state.tokenRecords.set("t1", makeToken("t1"));
    state.tokenRecords.set("t2", makeToken("t2"));
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("link -> revoke -> blocked -> re-link", async () => {
    const { confirmTelegramLink } = await import("@/bot/telegram-linking-flow");
    const { revokeAllSessionsForUser } = await import("@/lib/session-revoke");
    const logAudit = vi.fn(async () => undefined);

    const first = await confirmTelegramLink({
      prisma,
      tokenId: "t1",
      telegramId: "123",
      now: state.now,
      logAudit,
    });
    expect(first.ok).toBe(true);
    expect(state.user.telegramId).toBe("123");
    expect(state.user.globalRevokeCounter).toBe(0);

    await revokeAllSessionsForUser(state.user.id);
    expect(state.user.globalRevokeCounter).toBe(1);

    const blocked = getTelegramAccessBlockMessage({
      isActive: state.user.isActive,
      globalRevokeCounter: state.user.globalRevokeCounter,
    });
    expect(blocked).toContain("отозван");

    const second = await confirmTelegramLink({
      prisma,
      tokenId: "t2",
      telegramId: "123",
      now: state.now,
      logAudit,
    });
    expect(second.ok).toBe(true);
    expect(state.user.globalRevokeCounter).toBe(0);

    const allowed = getTelegramAccessBlockMessage({
      isActive: state.user.isActive,
      globalRevokeCounter: state.user.globalRevokeCounter,
    });
    expect(allowed).toBeNull();
  });
});
