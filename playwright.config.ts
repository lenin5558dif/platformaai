import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const testAuthEnv = {
  AUTH_BYPASS: "1",
  AUTH_BYPASS_EMAIL: "e2e@platforma.local",
  AUTH_BYPASS_ROLE: "ADMIN",
  AUTH_BYPASS_BALANCE: "1000",
  __NEXT_TEST_MODE: "1",
  AUTH_SECRET: "e2e-test-secret",
  NEXTAUTH_SECRET: "e2e-test-secret",
  APP_URL: baseURL,
  NEXTAUTH_URL: baseURL,
  NEXT_PUBLIC_APP_URL: baseURL,
  DATABASE_URL:
    "postgresql://platformaai:platformaai_password@127.0.0.1:5433/platformaai?schema=public",
  OPENROUTER_API_KEY: "sk-test",
  UNISENDER_API_KEY: "uniset-test",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_test_placeholder",
  OPENROUTER_SITE_URL: baseURL,
  OPENROUTER_APP_NAME: "PlatformaAI",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  retries: process.env.CI ? 2 : 0,
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
        url: baseURL,
        env: testAuthEnv,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
