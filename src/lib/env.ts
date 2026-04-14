import { z } from "zod";

const requiredText = (name: string) =>
  z.string().trim().min(1, `${name} is required`);

function normalizeUrlInput(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

const urlSchema = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeUrlInput)
  .pipe(z.string().url());

function normalizeComparableUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: requiredText("DATABASE_URL"),
    AUTH_SECRET: requiredText("AUTH_SECRET"),
    NEXTAUTH_SECRET: z.string().trim().min(1).optional(),
    NEXTAUTH_URL: urlSchema,
    NEXT_PUBLIC_APP_URL: urlSchema,
    APP_URL: urlSchema.optional(),

    OPENROUTER_API_KEY: requiredText("OPENROUTER_API_KEY"),
    UNISENDER_API_KEY: requiredText("UNISENDER_API_KEY"),
    STRIPE_SECRET_KEY: requiredText("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: requiredText("STRIPE_WEBHOOK_SECRET"),

    UNISENDER_SENDER_EMAIL: z.string().trim().email().optional(),
    UNISENDER_SENDER_NAME: z.string().trim().min(1).optional(),
    AUTH_EMAIL_BLOCKLIST: z.string().trim().optional(),
    AUTH_EMAIL_SUSPICIOUS_DOMAINS: z.string().trim().optional(),

    OPENROUTER_BASE_URL: urlSchema.optional(),
    OPENROUTER_SITE_URL: urlSchema.optional(),
    OPENROUTER_APP_NAME: z.string().trim().min(1).optional(),
    OPENROUTER_MARKUP: z.string().trim().optional(),
    USD_PER_CREDIT: z.string().trim().optional(),
    WHISPER_USD_PER_MINUTE: z.string().trim().optional(),
    OPENAI_API_KEY: z.string().trim().min(1).optional(),
    WHISPER_MODEL: z.string().trim().min(1).optional(),
    WHISPER_LANGUAGE: z.string().trim().min(1).optional(),

    TELEGRAM_BOT_TOKEN: z.string().trim().min(1).optional(),
    TELEGRAM_LOGIN_BOT_NAME: z.string().trim().min(1).optional(),
    NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: z.string().trim().min(1).optional(),

    SSO_ISSUER: urlSchema.optional(),
    SSO_CLIENT_ID: z.string().trim().min(1).optional(),
    SSO_CLIENT_SECRET: z.string().trim().min(1).optional(),
    SSO_NAME: z.string().trim().min(1).optional(),
    NEXT_PUBLIC_SSO_ENABLED: z.enum(["0", "1"]).optional(),

    AUTH_BYPASS: z.enum(["0", "1"]).optional(),
    AUTH_BYPASS_EMAIL: z.string().trim().email().optional(),
    AUTH_BYPASS_ROLE: z.enum(["USER", "ADMIN", "EMPLOYEE"]).optional(),
    AUTH_BYPASS_BALANCE: z.string().trim().optional(),
    GLOBAL_ADMIN_EMAILS: z.string().trim().optional(),

    BILLING_REFILL_TOKEN: z.string().trim().min(1).optional(),
    CRON_SECRET: z.string().trim().min(1).optional(),

    AUDIT_LOG_PURGE_INTERVAL_MS: z.string().trim().optional(),
    AUDIT_LOG_ENABLED: z.enum(["0", "1"]).optional(),
    LOG_EVENTS: z.enum(["0", "1"]).optional(),
    ENABLE_CHAT_SUMMARY: z.enum(["0", "1"]).optional(),
    MODERATION_ENABLED: z.enum(["0", "1"]).optional(),
    MODERATION_BLOCKLIST: z.string().trim().optional(),
    AUDIT_LOG_RETENTION_ENABLED: z.enum(["0", "1"]).optional(),
    AUDIT_LOG_RETENTION_DAYS: z.string().trim().optional(),
    AUDIT_LOG_RETENTION_BATCH_SIZE: z.string().trim().optional(),
    AUDIT_LOG_RETENTION_BATCH_DELAY_MS: z.string().trim().optional(),
    AUDIT_LOG_RETENTION_MAX_RUNTIME_MINUTES: z.string().trim().optional(),
    AUDIT_LOG_RETENTION_DRY_RUN: z.enum(["0", "1"]).optional(),
    AUDIT_LOG_METRICS_ENABLED: z.enum(["0", "1"]).optional(),
    AUDIT_LOG_METRICS_ACTION_TYPES: z.string().trim().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NEXTAUTH_SECRET && env.NEXTAUTH_SECRET !== env.AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXTAUTH_SECRET"],
        message: "NEXTAUTH_SECRET must match AUTH_SECRET when both are set",
      });
    }

    const canonicalUrl = normalizeComparableUrl(env.NEXTAUTH_URL);
    const urlPairs: Array<[string, string | undefined]> = [
      ["APP_URL", env.APP_URL],
      ["NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL],
    ];

    for (const [key, value] of urlPairs) {
      if (value && normalizeComparableUrl(value) !== canonicalUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must match NEXTAUTH_URL`,
        });
      }
    }

    if (env.SSO_ISSUER || env.SSO_CLIENT_ID || env.SSO_CLIENT_SECRET) {
      const ssoValues = [
        ["SSO_ISSUER", env.SSO_ISSUER],
        ["SSO_CLIENT_ID", env.SSO_CLIENT_ID],
        ["SSO_CLIENT_SECRET", env.SSO_CLIENT_SECRET],
      ] as const;

      for (const [key, value] of ssoValues) {
        if (value) {
          continue;
        }
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be set together with the other SSO_* values`,
        });
      }
    }

    if (
      env.TELEGRAM_LOGIN_BOT_NAME &&
      env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME &&
      env.TELEGRAM_LOGIN_BOT_NAME !== env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME"],
        message:
          "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME must match TELEGRAM_LOGIN_BOT_NAME",
      });
    }

    if (
      env.TELEGRAM_BOT_TOKEN ||
      env.TELEGRAM_LOGIN_BOT_NAME ||
      env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME
    ) {
      const telegramValues = [
        ["TELEGRAM_BOT_TOKEN", env.TELEGRAM_BOT_TOKEN],
        ["TELEGRAM_LOGIN_BOT_NAME", env.TELEGRAM_LOGIN_BOT_NAME],
        [
          "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME",
          env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME,
        ],
      ] as const;

      for (const [key, value] of telegramValues) {
        if (value) {
          continue;
        }

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be set together with the other Telegram auth values`,
        });
      }
    }

    if (env.NODE_ENV === "production" && env.AUTH_BYPASS === "1") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_BYPASS"],
        message: "AUTH_BYPASS must never be enabled in production",
      });
    }
  });

function formatIssues(issues: z.ZodIssue[]) {
  return issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return `- ${path}${issue.message}`;
  });
}

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    [
      "Invalid environment configuration:",
      ...formatIssues(parsedEnv.error.issues),
    ].join("\n")
  );
}

export const env = parsedEnv.data;
