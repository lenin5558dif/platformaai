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
  tempAccess: boolean;
};

export type AuthEmailGuardrails = {
  blockedEntries: string[];
  suspiciousDomains: string[];
};

export type AuthEmailGuardrailDecision = {
  normalizedEmail: string;
  domain: string | null;
  blocked: boolean;
  suspicious: boolean;
  match: string | null;
};

export type MappedAuthError = {
  state: AuthViewState;
  title: string;
  message: string;
  action: "retry" | "use_sso" | "contact_admin" | null;
};

function parseCsvList(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function splitEmailAddress(value: string) {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.lastIndexOf("@");

  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return {
      normalized,
      domain: null,
    };
  }

  return {
    normalized,
    domain: normalized.slice(atIndex + 1),
  };
}

function matchesEmailRule(entry: string, normalizedEmail: string, domain: string) {
  if (!entry) {
    return false;
  }

  if (entry.startsWith("@")) {
    return domain === entry.slice(1);
  }

  if (entry.startsWith(".")) {
    const suffix = entry.slice(1);
    return domain === suffix || domain.endsWith(`.${suffix}`);
  }

  if (entry.includes("@")) {
    return normalizedEmail === entry;
  }

  return domain === entry;
}

export function loadAuthEmailGuardrails(
  env: Record<string, string | undefined> = process.env
): AuthEmailGuardrails {
  return {
    blockedEntries: parseCsvList(env.AUTH_EMAIL_BLOCKLIST),
    suspiciousDomains: parseCsvList(env.AUTH_EMAIL_SUSPICIOUS_DOMAINS),
  };
}

export function evaluateAuthEmailGuardrails(
  value: string,
  guardrails: AuthEmailGuardrails = loadAuthEmailGuardrails()
): AuthEmailGuardrailDecision {
  const { normalized, domain } = splitEmailAddress(value);

  if (!domain) {
    return {
      normalizedEmail: normalized,
      domain: null,
      blocked: false,
      suspicious: false,
      match: null,
    };
  }

  const blockedMatch = guardrails.blockedEntries.find((entry) =>
    matchesEmailRule(entry, normalized, domain)
  );
  const suspiciousMatch = guardrails.suspiciousDomains.find((entry) =>
    matchesEmailRule(entry, normalized, domain)
  );

  return {
    normalizedEmail: normalized,
    domain,
    blocked: Boolean(blockedMatch),
    suspicious: Boolean(suspiciousMatch),
    match: blockedMatch ?? suspiciousMatch ?? null,
  };
}

export function getAuthCapabilities(
  env: Record<string, string | undefined> = process.env
): AuthCapabilities {
  const ssoConfigured =
    env.SSO_ISSUER && env.SSO_CLIENT_ID && env.SSO_CLIENT_SECRET;
  const telegramConfigured =
    env.TELEGRAM_BOT_TOKEN &&
    env.TELEGRAM_LOGIN_BOT_NAME &&
    env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME;

  return {
    email: true,
    sso: Boolean(ssoConfigured) && env.NEXT_PUBLIC_SSO_ENABLED !== "0",
    telegram: Boolean(telegramConfigured),
    tempAccess:
      env.NEXT_PUBLIC_TEMP_ACCESS_ENABLED === "1" && Boolean(env.TEMP_ACCESS_TOKEN),
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
        "Заполните nickname, email и пароль. После регистрации можно сразу войти в чат.",
      emailAction: "Создать аккаунт",
      ssoAction: "Зарегистрироваться через SSO",
    };
  }

  return {
    title: "Вход в PlatformaAI",
    subtitle:
      "Войдите через email и пароль. SSO доступен при настройке организации.",
    emailAction: "Войти",
    ssoAction: "Войти через SSO",
  };
}

export function mapLoginError(error?: string): MappedAuthError | null {
  if (!error) {
    return null;
  }

  switch (error) {
    case "CredentialsSignin":
      return {
        state: "error",
        title: "Неверный email или пароль",
        message: "Проверьте данные и попробуйте снова.",
        action: "retry",
      };
    case "EmailSignInError":
      return {
        state: "error",
        title: "Не удалось отправить ссылку",
        message:
          "Слишком много запросов или временная ошибка отправки. Подождите немного и попробуйте снова.",
        action: "retry",
      };
    case "SSORequired":
      return {
        state: "error",
        title: "Требуется вход через SSO",
        message: "Для этого домена разрешен только вход через корпоративный SSO.",
        action: "use_sso",
      };
    case "EmailDomainBlocked":
      return {
        state: "error",
        title: "Email ограничен политикой доступа",
        message:
          "Для этого адреса или домена вход временно ограничен. Используйте корпоративную почту или обратитесь к администратору.",
        action: "contact_admin",
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
    case "AccountDisabled":
      return {
        state: "error",
        title: "Аккаунт отключен",
        message:
          "Этот аккаунт отключен администратором. Обратитесь к администратору организации для восстановления доступа.",
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
