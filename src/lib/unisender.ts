import { fetchWithTimeout } from "@/lib/fetch-timeout";
import nodemailer from "nodemailer";

const UNISENDER_TIMEOUT_MS = 10_000;

type OrgInvitePayload = {
  email: string;
  acceptUrl: string;
};

type PasswordResetPayload = {
  email: string;
  resetUrl: string;
};

type EmailVerificationPayload = {
  email: string;
  verificationUrl: string;
};

function getSenderIdentity() {
  return {
    email:
      process.env.SMTP_FROM_EMAIL ??
      process.env.UNISENDER_SENDER_EMAIL ??
      "",
    name:
      process.env.SMTP_FROM_NAME ??
      process.env.UNISENDER_SENDER_NAME ??
      "PlatformaAI",
  };
}

function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_FROM_EMAIL
  );
}

async function sendViaSmtp(params: {
  to: string;
  subject: string;
  text: string;
}) {
  const sender = getSenderIdentity();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure =
    process.env.SMTP_SECURE === "1" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
        : undefined,
  });

  await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: params.to,
    subject: params.subject,
    text: params.text,
  });
}

async function sendViaUniSender(params: {
  to: string;
  subject: string;
  text: string;
}) {
  const apiKey = process.env.UNISENDER_API_KEY;
  const sender = getSenderIdentity();

  if (!apiKey) {
    throw new Error("UNISENDER_API_KEY is not set");
  }

  if (!sender.email) {
    throw new Error("UNISENDER_SENDER_EMAIL is not set");
  }

  const body = new URLSearchParams({
    api_key: apiKey,
    email: params.to,
    sender_name: sender.name,
    sender_email: sender.email,
    subject: params.subject,
    body: params.text,
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

async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
}) {
  if (hasSmtpConfig()) {
    await sendViaSmtp(params);
    return;
  }

  await sendViaUniSender(params);
}

export async function sendOrgInviteEmail({ email, acceptUrl }: OrgInvitePayload) {
  await sendEmail({
    to: email,
    subject: "Приглашение в организацию PlatformaAI",
    text: `Перейдите по ссылке, чтобы принять приглашение: ${acceptUrl}`,
  });
}

export async function sendPasswordResetEmail({
  email,
  resetUrl,
}: PasswordResetPayload) {
  await sendEmail({
    to: email,
    subject: "Сброс пароля PlatformaAI",
    text: `Для сброса пароля перейдите по ссылке: ${resetUrl}`,
  });
}

export async function sendEmailVerificationEmail({
  email,
  verificationUrl,
}: EmailVerificationPayload) {
  await sendEmail({
    to: email,
    subject: "Подтверждение email в PlatformaAI",
    text: `Подтвердите ваш email по ссылке: ${verificationUrl}`,
  });
}
