import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  userSettings: null as any,
  orgCredential: null as any,
}));

const prisma = {
  user: {
    findUnique: vi.fn(async () => ({
      settings: state.userSettings,
    })),
    update: vi.fn(async () => ({ id: "user_1" })),
  },
  orgProviderCredential: {
    findUnique: vi.fn(async () => state.orgCredential),
    upsert: vi.fn(),
  },
} as any;

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/secret-crypto", () => ({
  encryptSecret: vi.fn((value: string) => `enc:${value}`),
  decryptSecret: vi.fn((value: string) =>
    value.startsWith("enc:") ? value.slice(4) : value
  ),
  secretFingerprint: vi.fn((value: string) => `fp:${value}`),
  maskSecretByFingerprint: vi.fn((value?: string | null) =>
    value ? `***${value.slice(-4)}` : "—"
  ),
}));

describe("provider credentials", () => {
  beforeEach(() => {
    state.userSettings = null;
    state.orgCredential = null;
    process.env.OPENROUTER_API_KEY = "env-key";
    vi.clearAllMocks();
  });

  test("prefers personal openrouter key over org and env", async () => {
    state.userSettings = {
      personalOpenRouterCredential: {
        encryptedSecret: "enc:user-key",
        secretFingerprint: "fp:user-key",
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    };
    state.orgCredential = {
      encryptedSecret: "enc:org-key",
      isActive: true,
      secretFingerprint: "fp:org-key",
    };

    const { resolveOpenRouterApiKey } = await import("@/lib/provider-credentials");
    const result = await resolveOpenRouterApiKey({
      userId: "user_1",
      orgId: "org_1",
    });

    expect(result).toBe("user-key");
  });

  test("falls back to org key when personal key is absent", async () => {
    state.orgCredential = {
      encryptedSecret: "enc:org-key",
      isActive: true,
      secretFingerprint: "fp:org-key",
    };

    const { resolveOpenRouterApiKey } = await import("@/lib/provider-credentials");
    const result = await resolveOpenRouterApiKey({
      userId: "user_1",
      orgId: "org_1",
    });

    expect(result).toBe("org-key");
  });

  test("falls back to env key when user and org keys are missing", async () => {
    const { resolveOpenRouterApiKey } = await import("@/lib/provider-credentials");
    const result = await resolveOpenRouterApiKey({
      userId: "user_1",
      orgId: "org_1",
    });

    expect(result).toBe("env-key");
  });
});
