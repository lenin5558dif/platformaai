type InviteApiErrorCode =
  | "RATE_LIMITED"
  | "INVITE_EXISTS"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  | "INVITE_ALREADY_USED"
  | "INVITE_EMAIL_MISMATCH"
  | "EMAIL_NOT_VERIFIED"
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
        message: "Для этого email уже есть активный инвайт. Используйте resend или revoke.",
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
        title: "Email не совпадает",
        message: "Войдите под тем email, на который отправлен инвайт, и повторите попытку.",
        tone: "error",
      };
    case "EMAIL_NOT_VERIFIED":
      return {
        title: "Email не подтвержден",
        message: "Подтвердите email у провайдера входа и повторите принятие инвайта.",
        tone: "warning",
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
