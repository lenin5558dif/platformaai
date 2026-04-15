import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  nextAuthConfig: null as any,
}));

vi.mock("next-auth", () => ({
  default: vi.fn((config: any) => {
    state.nextAuthConfig = config;
    return {
      handlers: {},
      auth: vi.fn(),
      signOut: vi.fn(),
    };
  }),
}));

vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

describe("auth SSO linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.nextAuthConfig = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("disables dangerous email linking for the SSO provider", async () => {
    vi.stubEnv("SSO_ISSUER", "https://issuer.example");
    vi.stubEnv("SSO_CLIENT_ID", "client-id");
    vi.stubEnv("SSO_CLIENT_SECRET", "client-secret");

    await import("../src/lib/auth");

    const ssoProvider = state.nextAuthConfig.providers.find(
      (provider: any) => provider.id === "sso"
    );

    expect(ssoProvider).toMatchObject({
      id: "sso",
      allowDangerousEmailAccountLinking: false,
    });
  });
});
