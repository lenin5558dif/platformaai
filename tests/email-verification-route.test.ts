import { beforeEach, describe, expect, test, vi } from "vitest";

const mockConsumeEmailVerificationToken = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => vi.fn(async () => null));

vi.mock("@/lib/email-verification", () => ({
  consumeEmailVerificationToken: mockConsumeEmailVerificationToken,
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

describe("email verification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXTAUTH_URL;
    mockAuth.mockResolvedValue(null);
  });

  test("redirects to invalid when token is missing", async () => {
    const { GET } = await import("../src/app/api/auth/email/verify/route");

    const res = await GET(new Request("http://localhost/api/auth/email/verify"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?mode=signin&verification=invalid"
    );
    expect(mockConsumeEmailVerificationToken).not.toHaveBeenCalled();
  });

  test("redirects to expired when token is stale", async () => {
    mockConsumeEmailVerificationToken.mockResolvedValue({
      ok: false,
      reason: "TOKEN_EXPIRED",
    });
    const { GET } = await import("../src/app/api/auth/email/verify/route");

    const res = await GET(
      new Request("http://localhost/api/auth/email/verify?token=expired")
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?mode=signin&verification=expired"
    );
    expect(mockConsumeEmailVerificationToken).toHaveBeenCalledWith("expired");
  });

  test("redirects to invalid when token is unknown", async () => {
    mockConsumeEmailVerificationToken.mockResolvedValue({
      ok: false,
      reason: "TOKEN_INVALID",
    });
    const { GET } = await import("../src/app/api/auth/email/verify/route");

    const res = await GET(
      new Request("http://localhost/api/auth/email/verify?token=invalid")
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?mode=signin&verification=invalid"
    );
  });

  test("redirects to verified on success", async () => {
    mockConsumeEmailVerificationToken.mockResolvedValue({
      ok: true,
      userId: "user_1",
      email: "user@example.com",
    });
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const { GET } = await import("../src/app/api/auth/email/verify/route");

    const res = await GET(
      new Request("http://localhost/api/auth/email/verify?token=valid")
    );

    expect(res.headers.get("location")).toBe(
      "https://app.example.com/login?mode=signin&verification=verified"
    );
  });

  test("redirects back to settings when user is already signed in", async () => {
    mockConsumeEmailVerificationToken.mockResolvedValue({
      ok: true,
      userId: "user_1",
      email: "user@example.com",
    });
    mockAuth.mockResolvedValue({
      user: { id: "user_1" },
    } as any);
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const { GET } = await import("../src/app/api/auth/email/verify/route");

    const res = await GET(
      new Request("http://localhost/api/auth/email/verify?token=valid")
    );

    expect(res.headers.get("location")).toBe(
      "https://app.example.com/settings?verification=verified"
    );
  });
});
