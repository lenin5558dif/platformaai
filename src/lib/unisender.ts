import { fetchWithTimeout } from "@/lib/fetch-timeout";

const UNISENDER_TIMEOUT_MS = 10_000;

type OrgInvitePayload = {
  email: string;
  acceptUrl: string;
};

type PasswordResetPayload = {
  email: string;
  resetUrl: string;
};

export async function sendOrgInviteEmail({ email, acceptUrl }: OrgInvitePayload) {
  const apiKey = process.env.UNISENDER_API_KEY;
  const senderEmail = process.env.UNISENDER_SENDER_EMAIL;
  const senderName = process.env.UNISENDER_SENDER_NAME ?? "PlatformaAI";

  if (!apiKey) {
    throw new Error("UNISENDER_API_KEY is not set");
  }

  if (!senderEmail) {
    throw new Error("UNISENDER_SENDER_EMAIL is not set");
  }

  const body = new URLSearchParams({
    api_key: apiKey,
    email,
    sender_name: senderName,
    sender_email: senderEmail,
    subject: "Приглашение в организацию PlatformaAI",
    body: `Перейдите по ссылке, чтобы принять приглашение: ${acceptUrl}`,
  });

  const response = await fetchWithTimeout(
    "https://api.unisender.com/ru/api/sendEmail",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      timeoutMs: UNISENDER_TIMEOUT_MS,
      timeoutLabel: "UniSender sendEmail",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`UniSender error: ${text}`);
  }
}

export async function sendPasswordResetEmail({
  email,
  resetUrl,
}: PasswordResetPayload) {
  const apiKey = process.env.UNISENDER_API_KEY;
  const senderEmail = process.env.UNISENDER_SENDER_EMAIL;
  const senderName = process.env.UNISENDER_SENDER_NAME ?? "PlatformaAI";

  if (!apiKey) {
    throw new Error("UNISENDER_API_KEY is not set");
  }

  if (!senderEmail) {
    throw new Error("UNISENDER_SENDER_EMAIL is not set");
  }

  const body = new URLSearchParams({
    api_key: apiKey,
    email,
    sender_name: senderName,
    sender_email: senderEmail,
    subject: "Сброс пароля PlatformaAI",
    body: `Для сброса пароля перейдите по ссылке: ${resetUrl}`,
  });

  const response = await fetchWithTimeout(
    "https://api.unisender.com/ru/api/sendEmail",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      timeoutMs: UNISENDER_TIMEOUT_MS,
      timeoutLabel: "UniSender sendEmail",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`UniSender error: ${text}`);
  }
}
