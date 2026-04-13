export type AdminServiceStatus = "ready" | "partial" | "missing";

type ServiceDefinition = {
  id: string;
  name: string;
  description: string;
  requiredEnv: string[];
  optionalEnv?: string[];
  docsUrl?: string;
};

export type AdminServiceSnapshot = ServiceDefinition & {
  status: AdminServiceStatus;
  presentRequired: string[];
  missingRequired: string[];
  presentOptional: string[];
  missingOptional: string[];
};

export type AdminApiEndpoint = {
  serviceId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  access: string;
  description: string;
};

export type AdminApiGroup = {
  serviceId: string;
  serviceName: string;
  endpoints: AdminApiEndpoint[];
};

const SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "LLM-запросы и каталог моделей.",
    requiredEnv: ["OPENROUTER_API_KEY"],
    optionalEnv: [
      "OPENROUTER_BASE_URL",
      "OPENROUTER_SITE_URL",
      "OPENROUTER_APP_NAME",
      "OPENROUTER_MARKUP",
    ],
    docsUrl: "https://openrouter.ai/docs/api-reference/overview",
  },
  {
    id: "openai-whisper",
    name: "OpenAI Whisper",
    description: "STT для голосовых сообщений Telegram.",
    requiredEnv: ["OPENAI_API_KEY"],
    optionalEnv: ["WHISPER_MODEL", "WHISPER_LANGUAGE", "WHISPER_USD_PER_MINUTE"],
    docsUrl: "https://platform.openai.com/docs/api-reference/audio/createTranscription",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Checkout и обработка webhook платежей.",
    requiredEnv: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    optionalEnv: ["USD_PER_CREDIT"],
    docsUrl: "https://docs.stripe.com/api",
  },
  {
    id: "telegram",
    name: "Telegram Bot API",
    description: "Привязка аккаунта и сообщения из Telegram.",
    requiredEnv: ["TELEGRAM_BOT_TOKEN"],
    optionalEnv: [
      "TELEGRAM_WEBHOOK_SECRET",
      "TELEGRAM_LOGIN_BOT_NAME",
      "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME",
      "NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED",
    ],
    docsUrl: "https://core.telegram.org/bots/api",
  },
  {
    id: "unisender",
    name: "UniSender",
    description: "Рассылка email-инвайтов в организацию.",
    requiredEnv: ["UNISENDER_API_KEY", "UNISENDER_SENDER_EMAIL"],
    optionalEnv: ["UNISENDER_SENDER_NAME"],
    docsUrl: "https://www.unisender.com/ru/support/api/",
  },
  {
    id: "upstash",
    name: "Upstash Redis",
    description: "Рейт-лимиты и AI-кеш в распределенном режиме.",
    requiredEnv: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    docsUrl: "https://upstash.com/docs/redis/features/restapi",
  },
  {
    id: "sso",
    name: "OIDC / SSO",
    description: "Вход через корпоративного identity-провайдера.",
    requiredEnv: ["SSO_ISSUER", "SSO_CLIENT_ID", "SSO_CLIENT_SECRET"],
    optionalEnv: ["SSO_NAME", "NEXT_PUBLIC_SSO_ENABLED"],
  },
  {
    id: "scim",
    name: "SCIM 2.0",
    description: "Provisioning пользователей и групп для B2B.",
    requiredEnv: [],
    docsUrl: "https://datatracker.ietf.org/doc/html/rfc7644",
  },
  {
    id: "internal",
    name: "Internal Ops API",
    description: "Метрики и cron-задачи с секретом.",
    requiredEnv: ["CRON_SECRET"],
  },
  {
    id: "billing-refill",
    name: "Billing Refill Token",
    description: "Защита внутреннего endpoint ручного пополнения.",
    requiredEnv: ["BILLING_REFILL_TOKEN"],
  },
];

const API_ENDPOINTS: AdminApiEndpoint[] = [
  {
    serviceId: "openrouter",
    method: "POST",
    path: "/api/ai/chat",
    access: "auth user",
    description: "Основной чат-запрос к LLM.",
  },
  {
    serviceId: "openrouter",
    method: "POST",
    path: "/api/ai/image",
    access: "auth user",
    description: "Генерация изображений через AI-провайдер.",
  },
  {
    serviceId: "openrouter",
    method: "GET",
    path: "/api/models",
    access: "auth user",
    description: "Каталог доступных моделей с фильтрацией политик.",
  },
  {
    serviceId: "stripe",
    method: "POST",
    path: "/api/payments/stripe/checkout",
    access: "auth user",
    description: "Создание checkout-сессии для покупки кредитов.",
  },
  {
    serviceId: "stripe",
    method: "POST",
    path: "/api/payments/stripe/webhook",
    access: "Stripe signature",
    description: "Подтверждение и зачисление платежей.",
  },
  {
    serviceId: "billing-refill",
    method: "POST",
    path: "/api/billing/refill",
    access: "org permission + refill token",
    description: "Ручное пополнение баланса сотрудника.",
  },
  {
    serviceId: "telegram",
    method: "POST",
    path: "/api/telegram/token",
    access: "auth user",
    description: "Выдать токен для привязки Telegram.",
  },
  {
    serviceId: "telegram",
    method: "GET",
    path: "/api/telegram/token?token=...",
    access: "token",
    description: "Подтвердить привязку аккаунта по токену.",
  },
  {
    serviceId: "telegram",
    method: "DELETE",
    path: "/api/telegram/unlink",
    access: "auth user",
    description: "Отвязать Telegram от веб-аккаунта.",
  },
  {
    serviceId: "telegram",
    method: "POST",
    path: "/api/telegram/webhook",
    access: "telegram secret",
    description: "Входящие сообщения Telegram-бота.",
  },
  {
    serviceId: "scim",
    method: "GET",
    path: "/api/scim/ServiceProviderConfig",
    access: "SCIM token",
    description: "SCIM-возможности провайдера.",
  },
  {
    serviceId: "scim",
    method: "GET",
    path: "/api/scim/ResourceTypes",
    access: "SCIM token",
    description: "SCIM-типы ресурсов.",
  },
  {
    serviceId: "scim",
    method: "GET",
    path: "/api/scim/Schemas",
    access: "SCIM token",
    description: "SCIM-схемы.",
  },
  {
    serviceId: "scim",
    method: "GET",
    path: "/api/scim/Users",
    access: "SCIM token",
    description: "Список пользователей SCIM.",
  },
  {
    serviceId: "scim",
    method: "POST",
    path: "/api/scim/Users",
    access: "SCIM token",
    description: "Создание пользователя SCIM.",
  },
  {
    serviceId: "scim",
    method: "GET",
    path: "/api/scim/Groups",
    access: "SCIM token",
    description: "Список групп SCIM.",
  },
  {
    serviceId: "scim",
    method: "POST",
    path: "/api/scim/Groups",
    access: "SCIM token",
    description: "Создание группы SCIM.",
  },
  {
    serviceId: "scim",
    method: "GET",
    path: "/api/scim/tokens",
    access: "org:scim.manage",
    description: "Список локальных SCIM-токенов организации.",
  },
  {
    serviceId: "scim",
    method: "POST",
    path: "/api/scim/tokens",
    access: "org:scim.manage",
    description: "Выпуск нового SCIM-токена.",
  },
  {
    serviceId: "scim",
    method: "DELETE",
    path: "/api/scim/tokens",
    access: "org:scim.manage",
    description: "Отзыв SCIM-токена.",
  },
  {
    serviceId: "unisender",
    method: "POST",
    path: "/api/org/invites",
    access: "org:invite.create",
    description: "Отправка приглашения участнику организации.",
  },
  {
    serviceId: "internal",
    method: "GET",
    path: "/api/internal/metrics",
    access: "x-cron-secret",
    description: "Prometheus-метрики платформы.",
  },
  {
    serviceId: "internal",
    method: "POST",
    path: "/api/internal/cron/quota-cleanup",
    access: "x-cron-secret",
    description: "Очистка устаревших резервов квот.",
  },
  {
    serviceId: "internal",
    method: "POST",
    path: "/api/internal/cron/audit-log-purge",
    access: "x-cron-secret",
    description: "Purge audit-логов по ретенции.",
  },
];

function hasEnvValue(env: Record<string, string | undefined>, key: string) {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

function resolveStatus(
  presentRequiredCount: number,
  requiredCount: number
): AdminServiceStatus {
  if (requiredCount === 0) return "ready";
  if (presentRequiredCount >= requiredCount) return "ready";
  if (presentRequiredCount > 0) return "partial";
  return "missing";
}

export function getAdminServiceSnapshots(
  env: Record<string, string | undefined> = process.env
) {
  return SERVICE_DEFINITIONS.map((service) => {
    const optionalEnv = service.optionalEnv ?? [];
    const presentRequired = service.requiredEnv.filter((key) =>
      hasEnvValue(env, key)
    );
    const missingRequired = service.requiredEnv.filter(
      (key) => !hasEnvValue(env, key)
    );
    const presentOptional = optionalEnv.filter((key) => hasEnvValue(env, key));
    const missingOptional = optionalEnv.filter((key) => !hasEnvValue(env, key));

    return {
      ...service,
      status: resolveStatus(presentRequired.length, service.requiredEnv.length),
      presentRequired,
      missingRequired,
      presentOptional,
      missingOptional,
    } satisfies AdminServiceSnapshot;
  });
}

export function getAdminApiGroups(): AdminApiGroup[] {
  const byService = new Map<string, AdminApiEndpoint[]>();
  for (const endpoint of API_ENDPOINTS) {
    const existing = byService.get(endpoint.serviceId) ?? [];
    existing.push(endpoint);
    byService.set(endpoint.serviceId, existing);
  }

  return SERVICE_DEFINITIONS.map((service) => ({
    serviceId: service.id,
    serviceName: service.name,
    endpoints: byService.get(service.id) ?? [],
  })).filter((group) => group.endpoints.length > 0);
}
