import { fetchWithTimeout } from "@/lib/fetch-timeout";
import nodemailer from "nodemailer";

const UNISENDER_TIMEOUT_MS = 10_000;

export type MailDeliveryErrorCode =
  | "SENDER_DOMAIN_NOT_CONFIGURED"
  | "RECIPIENT_NOT_ALLOWED"
  | "UNCONFIGURED";

export class MailDeliveryError extends Error {
  code: MailDeliveryErrorCode;

  constructor(code: MailDeliveryErrorCode, message: string) {
    super(message);
    this.name = "MailDeliveryError";
    this.code = code;
  }
}

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
      process.env.UNISENDER_SENDER_EMAIL ??
      process.env.SMTP_FROM_EMAIL ??
      "",
    name:
      process.env.UNISENDER_SENDER_NAME ??
      process.env.SMTP_FROM_NAME ??
      "PlatformaAI",
  };
}

function hasUniSenderConfig() {
  return Boolean(
    process.env.UNISENDER_API_KEY &&
      process.env.UNISENDER_SENDER_EMAIL
  );
}

function hasUniSenderHint() {
  return Boolean(
    process.env.UNISENDER_API_KEY ||
      process.env.UNISENDER_SENDER_EMAIL ||
      process.env.UNISENDER_SENDER_NAME
  );
}

function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_FROM_EMAIL
  );
}

function hasSmtpHint() {
  return Boolean(
    process.env.SMTP_HOST ||
      process.env.SMTP_FROM_EMAIL ||
      process.env.SMTP_FROM_NAME
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

  try {
    await transporter.sendMail({
      from: `"${sender.name}" <${sender.email}>`,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("No valid recipients") &&
      (message.includes("free_tier") ||
        message.includes("checked emails") ||
        message.includes("checked domains"))
    ) {
      throw new MailDeliveryError(
        "RECIPIENT_NOT_ALLOWED",
        "SMTP provider rejected the recipient. On the current Unisender Go tariff, sending is allowed only to verified addresses or verified domains."
      );
    }
    throw error;
  }
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
    if (
      text.includes('"code": 229') ||
      text.includes('"code":229') ||
      text.includes("Custom backend domain or tracking domain required for sending")
    ) {
      throw new MailDeliveryError(
        "SENDER_DOMAIN_NOT_CONFIGURED",
        "UniSender error: sending domain is not configured. Add a custom backend or tracking domain in UniSender and verify the sender domain."
      );
    }
    throw new Error(`UniSender error: ${text}`);
  }
}

async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
}) {
  if (hasSmtpConfig() || hasSmtpHint()) {
    await sendViaSmtp(params);
    return;
  }

  if (hasUniSenderConfig() || hasUniSenderHint()) {
    await sendViaUniSender(params);
    return;
  }

  throw new Error(
    "Mail delivery is not configured. Set UNISENDER_API_KEY + UNISENDER_SENDER_EMAIL or SMTP_HOST + SMTP_FROM_EMAIL."
  );
}

export function getMailDeliveryErrorCode(error: unknown): MailDeliveryErrorCode | null {
  if (error instanceof MailDeliveryError) {
    return error.code;
  }

  return null;
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
