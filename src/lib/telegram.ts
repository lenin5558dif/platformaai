import crypto from "crypto";

export type TelegramAuthPayload = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export function verifyTelegramLogin(
  payload: TelegramAuthPayload,
  botToken: string
) {
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  const { hash, ...data } = payload;
  const dataCheckString = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const isFresh =
    Math.floor(Date.now() / 1000) - payload.auth_date < 60 * 60 * 24;

  return hmac === hash && isFresh;
}
