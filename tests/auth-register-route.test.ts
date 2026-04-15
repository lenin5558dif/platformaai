import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  existingUser: false,
  existingHasPassword: false,
}));

const prisma = {
  user: {
    findUnique: vi.fn(async () =>
      state.existingUser
        ? {
            id: "existing",
            passwordHash: state.existingHasPassword ? "hash" : null,
            settings: {},
          }
        : null
    ),
    create: vi.fn(async (args: any) => ({
      id: "user_1",
      email: args?.data?.email ?? "new@example.com",
    })),
    update: vi.fn(async () => ({
      id: "existing",
      email: "name@example.com",
    })),
  },
  userChannel: {
    upsert: vi.fn(async () => ({ id: "channel_1" })),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("bcryptjs", () => ({
  hash: vi.fn(async (value: string) => `hashed:${value}`),
}));

describe("auth register route", () => {
  beforeEach(() => {
    state.existingUser = false;
    state.existingHasPassword = false;
    vi.clearAllMocks();
  });

  test("returns 400 for invalid payload", async () => {
    const { POST } = await import("../src/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: "ab",
          email: "name@example.com",
          password: "password1",
          confirmPassword: "password2",
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "VALIDATION_ERROR",
    });
  });

  test("returns 409 when email already exists", async () => {
    state.existingUser = true;
    state.existingHasPassword = true;
    const { POST } = await import("../src/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: "nickname",
          email: "name@example.com",
          password: "password1",
          confirmPassword: "password1",
        }),
      })
    );

    expect(res.status).toBe(409);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({
      error: "EMAIL_ALREADY_EXISTS",
    });
  });

  test("rejects takeover of legacy email-only account", async () => {
    state.existingUser = true;
    state.existingHasPassword = false;

    const { POST } = await import("../src/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: "legacy",
          email: "name@example.com",
          password: "password1",
          confirmPassword: "password1",
        }),
      })
    );

    expect(res.status).toBe(409);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test("creates user with hashed password and web binding", async () => {
    const { POST } = await import("../src/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: "nickname",
          email: "Name@Example.com",
          password: "password1",
          confirmPassword: "password1",
        }),
      })
    );

    expect(res.status).toBe(201);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "name@example.com" },
      select: { id: true },
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "name@example.com",
        passwordHash: "hashed:password1",
        isActive: true,
        role: "USER",
        emailVerifiedByProvider: null,
        settings: {
          profileFirstName: "nickname",
          onboarded: false,
        },
      },
      select: {
        id: true,
        email: true,
      },
    });
    expect(prisma.userChannel.upsert).toHaveBeenCalledWith({
      where: {
        userId_channel: {
          userId: "user_1",
          channel: "WEB",
        },
      },
      update: { externalId: "user_1" },
      create: {
        userId: "user_1",
        channel: "WEB",
        externalId: "user_1",
      },
    });
  });
});
