import { beforeEach, describe, expect, test, vi } from "vitest";

const mockSendMail = vi.hoisted(() => vi.fn());
const mockCreateTransport = vi.hoisted(() => vi.fn(() => ({
  sendMail: mockSendMail,
})));
const mockFetchWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

vi.mock("@/lib/fetch-timeout", () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

const mailEnvKeys = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_FROM_EMAIL",
  "SMTP_FROM_NAME",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "UNISENDER_API_KEY",
  "UNISENDER_SENDER_EMAIL",
  "UNISENDER_SENDER_NAME",
] as const;

function resetMailEnv() {
  for (const key of mailEnvKeys) {
    delete process.env[key];
  }
}

describe("unisender mailer", () => {
  beforeEach(() => {
    resetMailEnv();
    vi.clearAllMocks();
  });

  test("sends verification email through SMTP when only SMTP is configured", async () => {
    process.env.SMTP_HOST = "smtp.local";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_FROM_EMAIL = "noreply@example.com";
    process.env.SMTP_FROM_NAME = "PlatformaAI";
    process.env.SMTP_USER = "smtp-user";
    process.env.SMTP_PASSWORD = "smtp-pass";

    const { sendEmailVerificationEmail } = await import("../src/lib/unisender");
    await sendEmailVerificationEmail({
      email: "user@example.com",
      verificationUrl: "https://app.example.com/api/auth/email/verify?token=abc",
    });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.local",
      port: 465,
      secure: true,
      auth: {
        user: "smtp-user",
        pass: "smtp-pass",
      },
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"PlatformaAI" <noreply@example.com>',
      to: "user@example.com",
      subject: "Подтверждение email в PlatformaAI",
      text: "Подтвердите ваш email по ссылке: https://app.example.com/api/auth/email/verify?token=abc",
    });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  test("uses SMTP without auth when credentials are absent", async () => {
    process.env.SMTP_HOST = "smtp.local";
    process.env.SMTP_FROM_EMAIL = "noreply@example.com";

    const { sendOrgInviteEmail } = await import("../src/lib/unisender");
    await sendOrgInviteEmail({
      email: "invitee@example.com",
      acceptUrl: "https://app.example.com/invite/abc",
    });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.local",
      port: 587,
      secure: false,
      auth: undefined,
    });
    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"PlatformaAI" <noreply@example.com>',
      to: "invitee@example.com",
      subject: "Приглашение в организацию PlatformaAI",
      text: "Перейдите по ссылке, чтобы принять приглашение: https://app.example.com/invite/abc",
    });
  });

  test("uses UniSender when it is configured", async () => {
    process.env.UNISENDER_API_KEY = "unisender-key";
    process.env.UNISENDER_SENDER_EMAIL = "noreply@example.com";
    process.env.UNISENDER_SENDER_NAME = "PlatformaAI";
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      text: vi.fn(async () => ""),
    });

    const { sendPasswordResetEmail } = await import("../src/lib/unisender");
    await sendPasswordResetEmail({
      email: "user@example.com",
      resetUrl: "https://app.example.com/reset/abc",
    });

    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetchWithTimeout.mock.calls[0];
    expect(url).toBe("https://api.unisender.com/ru/api/sendEmail");
    expect(init).toMatchObject({
      method: "POST",
      timeoutMs: 10_000,
      timeoutLabel: "UniSender sendEmail",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    expect(String((init as any).body)).toContain("api_key=unisender-key");
    expect(String((init as any).body)).toContain("email=user%40example.com");
    expect(String((init as any).body)).toContain("sender_email=noreply%40example.com");
    expect(String((init as any).body)).toContain("subject=%D0%A1%D0%B1%D1%80%D0%BE%D1%81+%D0%BF%D0%B0%D1%80%D0%BE%D0%BB%D1%8F+PlatformaAI");
  });

  test("prefers SMTP when both SMTP and UniSender are configured", async () => {
    process.env.UNISENDER_API_KEY = "unisender-key";
    process.env.UNISENDER_SENDER_EMAIL = "noreply@example.com";
    process.env.UNISENDER_SENDER_NAME = "PlatformaAI";
    process.env.SMTP_HOST = "smtp.local";
    process.env.SMTP_FROM_EMAIL = "smtp@example.com";

    const { sendEmailVerificationEmail } = await import("../src/lib/unisender");
    await sendEmailVerificationEmail({
      email: "user@example.com",
      verificationUrl: "https://app.example.com/api/auth/email/verify?token=abc",
    });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.local",
      port: 587,
      secure: false,
      auth: undefined,
    });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  test("throws when UniSender api key is missing", async () => {
    process.env.UNISENDER_SENDER_EMAIL = "noreply@example.com";

    const { sendEmailVerificationEmail } = await import("../src/lib/unisender");
    await expect(
      sendEmailVerificationEmail({
        email: "user@example.com",
        verificationUrl: "https://app.example.com/api/auth/email/verify?token=abc",
      })
    ).rejects.toThrow("UNISENDER_API_KEY is not set");
  });

  test("throws when UniSender sender email is missing", async () => {
    process.env.UNISENDER_API_KEY = "unisender-key";

    const { sendEmailVerificationEmail } = await import("../src/lib/unisender");
    await expect(
      sendEmailVerificationEmail({
        email: "user@example.com",
        verificationUrl: "https://app.example.com/api/auth/email/verify?token=abc",
      })
    ).rejects.toThrow("UNISENDER_SENDER_EMAIL is not set");
  });

  test("throws on UniSender API failure", async () => {
    process.env.UNISENDER_API_KEY = "unisender-key";
    process.env.UNISENDER_SENDER_EMAIL = "noreply@example.com";
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      text: vi.fn(async () => "bad gateway"),
    });

    const { sendEmailVerificationEmail } = await import("../src/lib/unisender");
    await expect(
      sendEmailVerificationEmail({
        email: "user@example.com",
        verificationUrl: "https://app.example.com/api/auth/email/verify?token=abc",
      })
    ).rejects.toThrow("UniSender error: bad gateway");
  });

  test("maps UniSender domain configuration error to a clear message", async () => {
    process.env.UNISENDER_API_KEY = "unisender-key";
    process.env.UNISENDER_SENDER_EMAIL = "noreply@example.com";
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      text: vi.fn(
        async () =>
          '{"status":"error","code":229,"message":"Custom backend domain or tracking domain required for sending"}'
      ),
    });

    const { sendEmailVerificationEmail } = await import("../src/lib/unisender");
    await expect(
      sendEmailVerificationEmail({
        email: "user@example.com",
        verificationUrl: "https://app.example.com/api/auth/email/verify?token=abc",
      })
    ).rejects.toThrow(
      "UniSender error: sending domain is not configured. Add a custom backend or tracking domain in UniSender and verify the sender domain."
    );
  });

  test("throws a clear error when no mail provider is configured", async () => {
    const { sendEmailVerificationEmail } = await import("../src/lib/unisender");

    await expect(
      sendEmailVerificationEmail({
        email: "user@example.com",
        verificationUrl: "https://app.example.com/api/auth/email/verify?token=abc",
      })
    ).rejects.toThrow(
      "Mail delivery is not configured. Set UNISENDER_API_KEY + UNISENDER_SENDER_EMAIL or SMTP_HOST + SMTP_FROM_EMAIL."
    );
  });
});
