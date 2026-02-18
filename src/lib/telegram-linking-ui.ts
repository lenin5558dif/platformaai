import { maskEmail } from "@/lib/telegram-linking";

export type TelegramLinkViewState =
  | "idle"
  | "link_generated"
  | "awaiting_bot_confirmation"
  | "linked"
  | "error"
  | "unlinked";

export type TelegramLinkUiMessage = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
};

export function emitTelegramLinkingEvent(action: string, outcome: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("platforma:telegram-linking", {
      detail: {
        feature: "web-telegram-linking-flow-ui",
        action,
        outcome,
      },
    })
  );
}

export function mapTelegramLinkingError(codeOrMessage?: string): TelegramLinkUiMessage {
  const value = (codeOrMessage ?? "").toLowerCase();

  if (value.includes("rate") || value.includes("too many") || value.includes("429")) {
    return {
      tone: "warning",
      title: "Слишком много попыток",
      message: "Попробуйте снова через минуту.",
    };
  }

  if (value.includes("expired")) {
    return {
      tone: "warning",
      title: "Ссылка истекла",
      message: "Сгенерируйте новую ссылку и повторите привязку.",
    };
  }

  if (value.includes("conflict") || value.includes("already") || value.includes("used")) {
    return {
      tone: "warning",
      title: "Привязка не завершена",
      message: "Этот токен уже использован или Telegram уже привязан к другому аккаунту.",
    };
  }

  if (value.includes("forbidden") || value.includes("unauthorized") || value.includes("401")) {
    return {
      tone: "warning",
      title: "Требуется авторизация",
      message: "Войдите снова и повторите действие.",
    };
  }

  return {
    tone: "error",
    title: "Не удалось выполнить действие",
    message: "Повторите попытку. Если ошибка повторяется, обратитесь к администратору.",
  };
}

export function maskedIdentityHint(email?: string | null, orgName?: string | null): string {
  const masked = email ? maskEmail(email) : "u***@***";
  if (orgName) {
    return `${masked} • ${orgName}`;
  }
  return masked;
}
