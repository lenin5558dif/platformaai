import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    exclude: ["tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "src/app/api/auth/email/verify/route.ts",
        "src/app/api/billing/summary/route.ts",
        "src/app/api/me/route.ts",
        "src/app/api/models/route.ts",
        "src/app/api/payments/stripe/checkout/route.ts",
        "src/app/api/payments/stripe/webhook/route.ts",
        "src/lib/billing-display.ts",
        "src/lib/billing-tiers.ts",
        "src/lib/chat-ui.ts",
        "src/lib/email-verification.ts",
        "src/lib/pricing.ts",
        "src/lib/quota-estimation.ts",
        "src/lib/unisender.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
