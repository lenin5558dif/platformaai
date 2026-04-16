import { beforeEach, describe, expect, test, vi } from "vitest";

const state = {
  tokens: new Map<string, any>(),
  users: new Map<string, any>(),
};

const prisma = {
  verificationToken: {
    deleteMany: vi.fn(async ({ where }: any) => {
      const prefix = where?.identifier?.startsWith;
      if (!prefix) return { count: 0 };
      let count = 0;
      for (const [token, record] of state.tokens.entries()) {
        if (String(record.identifier).startsWith(prefix)) {
          state.tokens.delete(token);
          count += 1;
        }
      }
      return { count };
    }),
    create: vi.fn(async ({ data }: any) => {
      state.tokens.set(data.token, { ...data });
      return { ...data };
    }),
    findUnique: vi.fn(async ({ where }: any) => state.tokens.get(where.token) ?? null),
    delete: vi.fn(async ({ where }: any) => {
      state.tokens.delete(where.token);
      return { token: where.token };
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => state.users.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: any) => {
      const user = state.users.get(where.id);
      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }
      Object.assign(user, data);
      state.users.set(where.id, user);
      return user;
    }),
  },
  $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
} as any;

vi.mock("@/lib/db", () => ({ prisma }));

const envKeys = [
  "NEXT_PUBLIC_APP_URL",
] as const;

function resetEnv() {
  for (const key of envKeys) {
    delete process.env[key];
  }
}

describe("email verification helpers", () => {
  beforeEach(() => {
    state.tokens.clear();
    state.users.clear();
    resetEnv();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("builds verification url from a normalized base", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    const { buildEmailVerificationUrl } = await import("../src/lib/email-verification");

    expect(buildEmailVerificationUrl("tok+en")).toBe(
      "https://app.example.com/api/auth/email/verify?token=tok%2Ben"
    );
  });

  test("issues a token with the default ttl and replaces previous tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00.000Z"));
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    state.tokens.set("old_token", {
      identifier: "email-verify:user_1:old@example.com",
      token: "old_token",
      expires: new Date("2026-04-16T12:00:00.000Z"),
    });

    const { issueEmailVerificationToken } = await import("../src/lib/email-verification");
    const result = await issueEmailVerificationToken({
      userId: "user_1",
      email: "Name@Example.com",
    });

    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.verificationUrl).toBe(
      `https://app.example.com/api/auth/email/verify?token=${result.token}`
    );
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: {
        identifier: {
          startsWith: "email-verify:user_1:",
        },
      },
    });
    expect(prisma.verificationToken.create).toHaveBeenCalledWith({
      data: {
        identifier: "email-verify:user_1:name@example.com",
        token: result.token,
        expires: new Date("2026-04-16T12:00:00.000Z"),
      },
    });
  });

  test("issues a token with a custom ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00.000Z"));

    const { issueEmailVerificationToken } = await import("../src/lib/email-verification");
    const result = await issueEmailVerificationToken({
      userId: "user_2",
      email: "custom@example.com",
      ttlMinutes: 15,
    });

    expect(result.expires).toEqual(new Date("2026-04-15T12:15:00.000Z"));
    expect(prisma.verificationToken.create).toHaveBeenCalledWith({
      data: {
        identifier: "email-verify:user_2:custom@example.com",
        token: result.token,
        expires: new Date("2026-04-15T12:15:00.000Z"),
      },
    });
  });

  test("consumes valid tokens and verifies the user", async () => {
    state.users.set("user_1", {
      id: "user_1",
      email: "user@example.com",
      emailVerifiedByProvider: null,
    });
    state.tokens.set("token_1", {
      identifier: "email-verify:user_1:user@example.com",
      token: "token_1",
      expires: new Date("2030-04-15T13:00:00.000Z"),
    });

    const { consumeEmailVerificationToken } = await import("../src/lib/email-verification");
    const result = await consumeEmailVerificationToken("token_1");

    expect(result).toEqual({
      ok: true,
      userId: "user_1",
      email: "user@example.com",
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { emailVerifiedByProvider: true },
    });
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
      where: { token: "token_1" },
    });
  });

  test("returns invalid for missing, malformed and mismatched tokens", async () => {
    state.users.set("user_1", {
      id: "user_1",
      email: "user@example.com",
    });
    state.tokens.set("bad_identifier", {
      identifier: "bad-identifier",
      token: "bad_identifier",
      expires: new Date("2030-04-15T13:00:00.000Z"),
    });
    state.tokens.set("mismatch", {
      identifier: "email-verify:user_1:other@example.com",
      token: "mismatch",
      expires: new Date("2030-04-15T13:00:00.000Z"),
    });

    const { consumeEmailVerificationToken } = await import("../src/lib/email-verification");

    await expect(consumeEmailVerificationToken("missing_token")).resolves.toEqual({
      ok: false,
      reason: "TOKEN_INVALID",
    });
    await expect(consumeEmailVerificationToken("bad_identifier")).resolves.toEqual({
      ok: false,
      reason: "TOKEN_INVALID",
    });
    await expect(consumeEmailVerificationToken("mismatch")).resolves.toEqual({
      ok: false,
      reason: "TOKEN_INVALID",
    });
    expect(prisma.verificationToken.delete).toHaveBeenCalledTimes(2);
  });

  test("returns expired for stale tokens", async () => {
    state.tokens.set("expired_token", {
      identifier: "email-verify:user_1:user@example.com",
      token: "expired_token",
      expires: new Date("2020-04-15T11:59:59.000Z"),
    });

    const { consumeEmailVerificationToken } = await import("../src/lib/email-verification");
    const result = await consumeEmailVerificationToken("expired_token");

    expect(result).toEqual({
      ok: false,
      reason: "TOKEN_EXPIRED",
    });
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
      where: { token: "expired_token" },
    });
  });
});
