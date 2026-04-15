import { beforeEach, describe, expect, test, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: state.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: state.prisma,
}));

describe("authorize helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("requireSession throws unauthorized when no session user id", async () => {
    const { requireSession } = await import("../src/lib/authorize");
    state.auth.mockResolvedValueOnce(null);

    await expect(requireSession()).rejects.toEqual(
      expect.objectContaining({
        status: 401,
        code: "UNAUTHORIZED",
      }),
    );
  });

  test("requireSession returns the authenticated session and forwards request", async () => {
    const { requireSession } = await import("../src/lib/authorize");
    const request = new Request("http://localhost/protected");
    state.auth.mockResolvedValueOnce({ user: { id: "u-1" } });

    const session = await requireSession(request);

    expect(state.auth).toHaveBeenCalledWith(request);
    expect(session).toEqual({ user: { id: "u-1" } });
  });

  test("requireActiveUser rejects missing and inactive db users", async () => {
    const { requireActiveUser } = await import("../src/lib/authorize");

    await expect(requireActiveUser({ user: {} } as any)).rejects.toEqual(
      expect.objectContaining({
        status: 401,
        code: "UNAUTHORIZED",
      }),
    );

    state.prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(requireActiveUser({ user: { id: "u-1" } } as any)).rejects.toBeInstanceOf(HttpError);

    state.prisma.user.findUnique.mockResolvedValueOnce({ isActive: false });
    await expect(requireActiveUser({ user: { id: "u-1" } } as any)).rejects.toBeInstanceOf(HttpError);

    state.prisma.user.findUnique.mockResolvedValueOnce({ isActive: true });
    await expect(requireActiveUser({ user: { id: "u-1" } } as any)).resolves.toBeUndefined();
  });

  test("toErrorResponse serializes HttpError and rethrows unknown values", async () => {
    const { toErrorResponse } = await import("../src/lib/authorize");

    const response = toErrorResponse(new HttpError(418, "TEAPOT", "Short and stout"));
    expect(response.status).toBe(418);
    await expect(response.json()).resolves.toEqual({
      error: "Short and stout",
      code: "TEAPOT",
    });

    expect(() => toErrorResponse(new Error("boom"))).toThrow("boom");
  });
});
