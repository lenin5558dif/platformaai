import { hasRealConfiguredValue } from "@/lib/config-values";

export type TelegramAuthConfig = {
  enabled: boolean;
  botName: string | null;
};

export function getTelegramAuthConfig(
  env: Record<string, string | undefined> = process.env
): TelegramAuthConfig {
  const enabledByFlag = env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED !== "0";
  const publicBotName = hasRealConfiguredValue(env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME)
    ? env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME!.trim()
    : null;
  const serverBotName = hasRealConfiguredValue(env.TELEGRAM_LOGIN_BOT_NAME)
    ? env.TELEGRAM_LOGIN_BOT_NAME!.trim()
    : null;
  const botToken = hasRealConfiguredValue(env.TELEGRAM_BOT_TOKEN)
    ? env.TELEGRAM_BOT_TOKEN!.trim()
    : null;

  if (!enabledByFlag || !publicBotName || !serverBotName || !botToken) {
    return {
      enabled: false,
      botName: null,
    };
  }

  if (publicBotName !== serverBotName) {
    return {
      enabled: false,
      botName: null,
    };
  }

  return {
    enabled: true,
    botName: serverBotName,
  };
}
