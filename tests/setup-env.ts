const TEST_ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/platformaai",
  AUTH_SECRET: "test-auth-secret",
  NEXTAUTH_URL: "https://app.example",
  NEXT_PUBLIC_APP_URL: "https://app.example",
  OPENROUTER_API_KEY: "test-openrouter-key",
  UNISENDER_API_KEY: "test-unisender-key",
  STRIPE_SECRET_KEY: "test-stripe-secret",
  STRIPE_WEBHOOK_SECRET: "test-stripe-webhook-secret",
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  process.env[key] = value;
}

delete process.env.SSO_ISSUER;
delete process.env.SSO_CLIENT_ID;
delete process.env.SSO_CLIENT_SECRET;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_LOGIN_BOT_NAME;
delete process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME;
