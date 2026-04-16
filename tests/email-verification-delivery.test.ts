import { beforeEach, describe, expect, test, vi } from "vitest";

const issueEmailVerificationToken = vi.hoisted(() => vi.fn());
const sendEmailVerificationEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email-verification", () => ({
  issueEmailVerificationToken,
}));

vi.mock("@/lib/unisender", () => ({
  sendEmailVerificationEmail,
}));

describe("deliverEmailVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueEmailVerificationToken.mockResolvedValue({
      token: "verify_token",
      expires: new Date("2026-04-17T00:00:00.000Z"),
      verificationUrl: "https://app.example.com/api/auth/email/verify?token=verify_token",
    });
  });

  test("issues a token and sends the email", async () => {
    const { deliverEmailVerification } = await import(
      "../src/lib/email-verification-delivery"
    );

    const result = await deliverEmailVerification({
      userId: "user_1",
      email: "user@example.com",
    });

    expect(issueEmailVerificationToken).toHaveBeenCalledWith({
      userId: "user_1",
      email: "user@example.com",
    });
    expect(sendEmailVerificationEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      verificationUrl:
        "https://app.example.com/api/auth/email/verify?token=verify_token",
    });
    expect(result).toMatchObject({
      token: "verify_token",
    });
  });

  test("surfaces mail transport failures", async () => {
    sendEmailVerificationEmail.mockRejectedValueOnce(new Error("smtp down"));

    const { deliverEmailVerification } = await import(
      "../src/lib/email-verification-delivery"
    );

    await expect(
      deliverEmailVerification({
        userId: "user_1",
        email: "user@example.com",
      })
    ).rejects.toThrow("smtp down");
  });
});
