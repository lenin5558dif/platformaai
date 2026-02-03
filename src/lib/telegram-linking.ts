import * as bcrypt from "bcryptjs";

export const TELEGRAM_LINK_TOKEN_PREFIX_LEN = 16;

export function getTelegramLinkTokenPrefix(token: string) {
  return token.slice(0, TELEGRAM_LINK_TOKEN_PREFIX_LEN);
}

export function isTelegramLinkTokenMatch(params: {
  incomingToken: string;
  recordToken: string;
  recordHash?: string | null;
}) {
  if (params.recordHash) {
    return bcrypt.compareSync(params.incomingToken, params.recordHash);
  }

  return params.incomingToken === params.recordToken;
}

export function maskEmail(email?: string | null) {
  if (!email) return "***";
  const at = email.indexOf("@");
  if (at <= 0) {
    return `${email.slice(0, 1)}***`;
  }

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length <= 1) {
    return `***@${domain}`;
  }

  const first = local.slice(0, 1);
  const last = local.slice(-1);
  return `${first}***${last}@${domain}`;
}

export function buildTelegramLinkConfirmationPrompt(params: {
  maskedEmail: string;
  tokenId: string;
}) {
  return {
    text: `Подтвердите привязку Telegram к аккаунту ${params.maskedEmail}.`,
    confirmData: `tg_link_confirm:${params.tokenId}`,
    cancelData: `tg_link_cancel:${params.tokenId}`,
  };
}

export function isTelegramAccessRevoked(params: { globalRevokeCounter: number }) {
  return params.globalRevokeCounter > 0;
}

export function getTelegramAccessBlockMessage(params: {
  isActive: boolean;
  globalRevokeCounter: number;
}) {
  if (params.isActive === false) {
    return "Ваш аккаунт деактивирован. Обратитесь к администратору.";
  }

  if (isTelegramAccessRevoked({ globalRevokeCounter: params.globalRevokeCounter })) {
    return "Доступ через Telegram был отозван. Перейдите в веб и привяжите Telegram заново (кнопка 'Подключить Telegram').";
  }

  return null;
}
