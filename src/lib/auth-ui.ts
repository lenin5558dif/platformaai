export type AuthMode = "signin" | "register";

export type AuthViewState =
  | "idle"
  | "submitting"
  | "sent"
  | "success"
  | "error"
  | "expired";

export type AuthCapabilities = {
  email: boolean;
  sso: boolean;
  telegram: boolean;
};

type MappedAuthError = {
  state: AuthViewState;
  title: string;
  message: string;
  action: "retry" | "use_sso" | "contact_admin" | null;
};

export function getAuthCapabilities(
  env: Record<string, string | undefined> = process.env
): AuthCapabilities {
  const ssoConfigured =
    env.SSO_ISSUER && env.SSO_CLIENT_ID && env.SSO_CLIENT_SECRET;
  const telegramEnabled =
    env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED === "1" &&
    Boolean(env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME);

  return {
    email: true,
    sso: env.NEXT_PUBLIC_SSO_ENABLED === "1" || Boolean(ssoConfigured),
    telegram: telegramEnabled,
  };
}

export function resolveAuthMode(raw?: string): AuthMode {
  return raw === "register" ? "register" : "signin";
}

export function getModeText(mode: AuthMode) {
  if (mode === "register") {
    return {
      title: "Создание аккаунта PlatformaAI",
      subtitle:
        "Заполните никнейм, email и пароль. После регистрации можно сразу войти в чат.",
      emailAction: "Создать аккаунт",
      ssoAction: "Зарегистрироваться через SSO",
    };
  }

  return {
    title: "Вход в PlatformaAI",
    subtitle: "Войдите через email и пароль. SSO доступен при настройке организации.",
    emailAction: "Войти",
    ssoAction: "Войти через SSO",
  };
}

export function mapLoginError(error?: string): MappedAuthError | null {
  if (!error) {
    return null;
  }

  switch (error) {
    case "SSORequired":
      return {
        state: "error",
        title: "Требуется вход через SSO",
        message: "Для этого домена разрешен только вход через корпоративный SSO.",
        action: "use_sso",
      };
    case "CredentialsSignin":
      return {
        state: "error",
        title: "Неверный email или пароль",
        message: "Проверьте данные и попробуйте снова.",
        action: "retry",
      };
    case "Verification":
      return {
        state: "expired",
        title: "Ссылка недействительна",
        message:
          "Срок действия ссылки истек или она уже была использована. Запросите новую ссылку.",
        action: "retry",
      };
    case "AccessDenied":
      return {
        state: "error",
        title: "Доступ отклонен",
        message: "Вход отклонен политикой доступа. Обратитесь к администратору.",
        action: "contact_admin",
      };
    case "Configuration":
      return {
        state: "error",
        title: "Ошибка конфигурации входа",
        message: "Временно недоступен один из методов входа. Попробуйте другой метод.",
        action: "retry",
      };
    default:
      return {
        state: "error",
        title: "Не удалось выполнить вход",
        message: "Попробуйте еще раз или используйте другой доступный способ входа.",
        action: "retry",
      };
  }
}
