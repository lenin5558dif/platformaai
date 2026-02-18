export type GovernanceStatus = "ok" | "warning" | "blocked" | "unknown";

export type GovernanceUiMessage = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
};

export type GovernanceApiErrorCode =
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | string;

export function normalizeQuotaStatus(
  limit: number | null | undefined,
  spent: number | null | undefined,
  warningRatio = 0.8
): GovernanceStatus {
  if (limit === null || limit === undefined || limit <= 0) {
    return "unknown";
  }

  const used = Math.max(0, spent ?? 0);
  if (used >= limit) {
    return "blocked";
  }

  if (used / limit >= warningRatio) {
    return "warning";
  }

  return "ok";
}

export function mapGovernanceError(code?: GovernanceApiErrorCode): GovernanceUiMessage {
  switch (code) {
    case "FORBIDDEN":
      return {
        tone: "warning",
        title: "Недостаточно прав",
        message: "У вас нет прав на это действие.",
      };
    case "UNAUTHORIZED":
      return {
        tone: "warning",
        title: "Нужна авторизация",
        message: "Войдите заново и повторите действие.",
      };
    case "RATE_LIMITED":
      return {
        tone: "warning",
        title: "Слишком много запросов",
        message: "Операция временно ограничена, попробуйте позже.",
      };
    case "NOT_FOUND":
      return {
        tone: "error",
        title: "Данные не найдены",
        message: "Нужная сущность не найдена. Обновите страницу.",
      };
    case "INVALID_INPUT":
      return {
        tone: "error",
        title: "Некорректные параметры",
        message: "Проверьте введенные значения и повторите попытку.",
      };
    default:
      return {
        tone: "error",
        title: "Операция не выполнена",
        message: "Произошла ошибка. Попробуйте снова.",
      };
  }
}

export function statusBadgeClass(status: GovernanceStatus): string {
  if (status === "ok") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "warning") {
    return "bg-amber-100 text-amber-700";
  }
  if (status === "blocked") {
    return "bg-red-100 text-red-700";
  }
  return "bg-gray-100 text-gray-600";
}

export function statusLabel(status: GovernanceStatus): string {
  if (status === "ok") return "ok";
  if (status === "warning") return "warning";
  if (status === "blocked") return "blocked";
  return "unknown";
}

export function emitGovernanceEvent(feature: string, action: string, outcome: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("platforma:governance", {
      detail: {
        feature,
        action,
        outcome,
      },
    })
  );
}
