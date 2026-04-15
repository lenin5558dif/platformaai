type InviteApiErrorCode =
  | "RATE_LIMITED"
  | "INVITE_EXISTS"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  | "INVITE_ALREADY_USED"
  | "INVITE_EMAIL_MISMATCH"
  | "EMAIL_REQUIRED"
  | "EMAIL_NOT_VERIFIED"
  | "EMAIL_DOMAIN_BLOCKED"
  | "ROLE_NOT_FOUND"
  | "NOT_FOUND"
  | "INVALID_TOKEN"
  | "UNAUTHORIZED"
  | string;

export type InviteUiMessage = {
  title: string;
  message: string;
  tone: "info" | "success" | "warning" | "error";
};

export type InviteListItem = {
  id: string;
  email: string;
  roleId: string;
  defaultCostCenterId: string | null;
  tokenPrefix: string;
  expiresAt: string;
  createdAt: string;
  role: {
    id: string;
    name: string;
  };
};

type InviteActionResult = {
  ok: boolean;
  code?: InviteApiErrorCode;
  message?: string;
  status?: number;
};

export function mapInviteError(code?: InviteApiErrorCode): InviteUiMessage {
  switch (code) {
    case "RATE_LIMITED":
      return {
        title: "Слишком много попыток",
        message: "Действие временно ограничено. Попробуйте снова чуть позже.",
        tone: "warning",
      };
    case "INVITE_EXISTS":
      return {
        title: "Инвайт уже активен",
        message: "Для этой почты уже есть активный инвайт. Используйте повторную отправку или отзыв.",
        tone: "warning",
      };
    case "INVITE_EXPIRED":
      return {
        title: "Инвайт истек",
        message: "Срок действия приглашения закончился. Создайте новый инвайт.",
        tone: "warning",
      };
    case "INVITE_REVOKED":
      return {
        title: "Инвайт отозван",
        message: "Это приглашение уже отозвано администратором.",
        tone: "warning",
      };
    case "INVITE_ALREADY_USED":
      return {
        title: "Инвайт уже использован",
        message: "Приглашение уже было принято другим действием входа.",
        tone: "warning",
      };
    case "INVITE_EMAIL_MISMATCH":
      return {
        title: "Почта не совпадает",
        message: "Войдите под той почтой, на которую отправлен инвайт, и повторите попытку.",
        tone: "error",
      };
    case "EMAIL_REQUIRED":
      return {
        title: "Нужен аккаунт с почтой",
        message:
          "Для принятия приглашения нужен веб-аккаунт с той же почтой, на которую пришёл инвайт. Войдите по ссылке входа или через SSO и повторите попытку.",
        tone: "warning",
      };
    case "EMAIL_NOT_VERIFIED":
      return {
        title: "Почта не подтверждена",
        message: "Подтвердите почту у провайдера входа и повторите принятие инвайта.",
        tone: "warning",
      };
    case "EMAIL_DOMAIN_BLOCKED":
      return {
        title: "Почта ограничена политикой",
        message:
          "Для этой почты или домена доступ временно ограничен. Используйте другой корпоративный адрес или обратитесь к администратору.",
        tone: "error",
      };
    case "ROLE_NOT_FOUND":
      return {
        title: "Роль недоступна",
        message: "Выбранная роль не найдена. Обновите страницу и попробуйте снова.",
        tone: "error",
      };
    case "INVALID_TOKEN":
      return {
        title: "Неверная ссылка",
        message: "Ссылка приглашения недействительна. Запросите новую у администратора.",
        tone: "error",
      };
    case "UNAUTHORIZED":
      return {
        title: "Требуется вход",
        message: "Войдите в аккаунт, чтобы продолжить работу с приглашением.",
        tone: "warning",
      };
    default:
      return {
        title: "Операция не выполнена",
        message: "Попробуйте снова. Если ошибка повторяется, обратитесь к администратору.",
        tone: "error",
      };
  }
}

export async function parseInviteActionResult(
  response: Response
): Promise<InviteActionResult> {
  if (response.ok) {
    return { ok: true, status: response.status };
  }

  let code: InviteApiErrorCode | undefined;
  let message: string | undefined;

  try {
    const body = (await response.json()) as { code?: string; message?: string };
    code = body.code;
    message = body.message;
  } catch {
    // noop
  }

  return {
    ok: false,
    status: response.status,
    code,
    message,
  };
}
