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
    setupFiles: ["tests/setup-env.ts"],
    coverage: {
      exclude: [
        ".next/**",
        "coverage/**",
        "tests/**",
        "**/*.d.ts",
        "next-env.d.ts",
        "next.config.ts",
        "playwright.config.ts",
        "postcss.config.mjs",
        "vitest.config.ts",
        "prisma/**",
        "src/app/**/*.tsx",
        "src/components/**",
        "src/bot/**",
        "src/app/api/ai/chat/route.ts",
        "src/app/api/scim/Groups/[id]/route.ts",
        "src/app/api/scim/Users/route.ts",
        "src/app/api/scim/Users/[id]/route.ts",
      ],
      reportOnFailure: true,
    },
  },
});
