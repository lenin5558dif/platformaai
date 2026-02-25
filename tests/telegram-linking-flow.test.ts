import { beforeEach, describe, expect, test, vi } from "vitest";
import * as bcrypt from "bcryptjs";
import { beginTelegramLink, cancelTelegramLink, confirmTelegramLink } from "@/bot/telegram-linking-flow";

const state = vi.hoisted(() => ({
  now: new Date("2026-02-03T12:00:00.000Z"),
  token: "t".repeat(48),
  usedAt: null as Date | null,
  expiresAt: new Date("2026-02-03T12:10:00.000Z"),
  userId: "user_1",
  userEmail: "u@example.com",
  orgId: "org_1",
  existingTelegramUserId: null as string | null,
}));

function makePrisma() {
  const record = {
    id: "lt_1",
    token: state.token.slice(0, 16),
    telegramLinkTokenHash: bcrypt.hashSync(state.token, 10),
    userId: state.userId,
    usedAt: state.usedAt,
    expiresAt: state.expiresAt,
    user: { id: state.userId, orgId: state.orgId, email: state.userEmail },
  };

  return {
    telegramLinkToken: {
      findFirst: vi.fn(async () => record),
      findUnique: vi.fn(async () => record),
      update: vi.fn(async (args: any) => {
        if (args?.data?.usedAt) state.usedAt = args.data.usedAt;
        return { id: record.id };
      }),
    },
    user: {
      findUnique: vi.fn(async () =>
        state.existingTelegramUserId ? { id: state.existingTelegramUserId } : null
      ),
      update: vi.fn(async () => ({ id: state.userId })),
    },
  } as any;
}

describe("telegram linking flow", () => {
  beforeEach(async () => {
    state.usedAt = null;
    state.existingTelegramUserId = null;
    vi.clearAllMocks();
  });

  test("beginTelegramLink returns confirmation prompt with masked email", async () => {
    const prisma = makePrisma();
    const res = await beginTelegramLink({ prisma, token: state.token, now: state.now });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prompt.text).toContain("Подтвердите");
    expect(res.prompt.confirmData).toContain("tg_link_confirm:");
    expect(res.prompt.cancelData).toContain("tg_link_cancel:");
  });

  test("cancelTelegramLink invalidates token", async () => {
    const prisma = makePrisma();
    await cancelTelegramLink({ prisma, tokenId: "lt_1", now: state.now });
    expect(prisma.telegramLinkToken.update).toHaveBeenCalled();
    expect(state.usedAt).toEqual(state.now);
  });

  test("confirmTelegramLink links and emits audit", async () => {
    const prisma = makePrisma();
    const logAudit = vi.fn(async (_args: any) => undefined);

    const res = await confirmTelegramLink({
      prisma,
      tokenId: "lt_1",
      telegramId: "123",
      now: state.now,
      logAudit,
    });

    expect(res.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: state.userId },
      data: { telegramId: "123", globalRevokeCounter: 0 },
    });
    expect(logAudit).toHaveBeenCalled();
    const call = logAudit.mock.calls[0]?.[0] as any;
    expect(call?.action).toBe("TELEGRAM_LINKED");
    expect(call?.metadata?.telegram?.action).toBe("link");
  });

  test("confirmTelegramLink rejects if telegram already linked to other user", async () => {
    state.existingTelegramUserId = "other_user";
    const prisma = makePrisma();
    const logAudit = vi.fn(async (_args: any) => undefined);

    const res = await confirmTelegramLink({
      prisma,
      tokenId: "lt_1",
      telegramId: "123",
      now: state.now,
      logAudit,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("уже привязан");
    expect(logAudit).not.toHaveBeenCalled();
  });
});
