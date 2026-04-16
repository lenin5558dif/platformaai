import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  user: null as null | Record<string, unknown>,
  platformConfig: {
    disabledModelIds: [] as string[],
  },
  openRouterApiKey: "openrouter-test-key",
  models: [] as Array<{
    id: string;
    name: string;
    pricing?: {
      prompt?: string;
      completion?: string;
    };
  }>,
  fetchModelsError: null as null | Error,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? { user: { id: "user_1" } } : null)),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => state.user),
    },
  },
}));

vi.mock("@/lib/platform-config", () => ({
  getPlatformConfig: vi.fn(async () => state.platformConfig),
}));

vi.mock("@/lib/provider-credentials", () => ({
  resolveOpenRouterApiKey: vi.fn(async () => state.openRouterApiKey),
}));

vi.mock("@/lib/models", () => ({
  fetchModels: vi.fn(async () => {
    if (state.fetchModelsError) {
      throw state.fetchModelsError;
    }
    return state.models;
  }),
  filterFreeOpenRouterModels: vi.fn((models: Array<{ id: string }>) =>
    models.filter((model) => model.id.toLowerCase().endsWith(":free"))
  ),
}));

describe("api models route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.user = {
      id: "user_1",
      balance: 0,
      orgId: "org_1",
      settings: {
        billingTier: "free",
      },
      org: {
        settings: null,
      },
    };
    state.platformConfig = {
      disabledModelIds: ["gamma:free"],
    };
    state.openRouterApiKey = "openrouter-test-key";
    state.models = [
      {
        id: "alpha:free",
        name: "Alpha Free",
        pricing: {
          prompt: "0",
          completion: "0",
        },
      },
      {
        id: "beta",
        name: "Beta",
        pricing: {
          prompt: "0.000002",
          completion: "0.000002",
        },
      },
      {
        id: "gamma:free",
        name: "Gamma Free",
        pricing: {
          prompt: "0",
          completion: "0",
        },
      },
    ];
    state.fetchModelsError = null;
    vi.clearAllMocks();
  });

  test("returns 401 when the session is missing", async () => {
    state.authenticated = false;
    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized",
      code: "AUTH_UNAUTHORIZED",
    });
  });

  test("returns 401 when the OpenRouter key is missing", async () => {
    state.openRouterApiKey = null as unknown as string;
    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "OPENROUTER_API_KEY is not set",
      code: "OPENROUTER_KEY_MISSING",
    });
  });

  test("filters paid models out on the free tier", async () => {
    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.data).toHaveLength(1);
    expect(json.data.data[0]).toMatchObject({
      id: "alpha:free",
      name: "Alpha Free",
    });
  });

  test("returns all allowed models on a paid tier", async () => {
    state.user = {
      id: "user_1",
      balance: 500,
      orgId: "org_1",
      settings: {
        billingTier: "tier_500",
      },
      org: {
        settings: null,
      },
    };

    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.data).toHaveLength(2);
    expect(json.data.data.map((model: { id: string }) => model.id)).toEqual([
      "alpha:free",
      "beta",
    ]);
  });

  test("maps OpenRouter auth failures to the invalid key response", async () => {
    state.fetchModelsError = new Error("OpenRouter unauthorized: invalid API key");
    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "OpenRouter unauthorized: invalid API key",
      code: "OPENROUTER_KEY_INVALID",
    });
  });

  test("maps missing key errors thrown during fetch to the missing key response", async () => {
    state.fetchModelsError = new Error("OPENROUTER_API_KEY missing for OpenRouter");
    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "OPENROUTER_API_KEY missing for OpenRouter",
      code: "OPENROUTER_KEY_MISSING",
    });
  });

  test("maps unknown OpenRouter failures to a generic error", async () => {
    state.fetchModelsError = new Error("OpenRouter models timeout");
    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "OpenRouter models timeout",
      code: "OPENROUTER_ERROR",
    });
  });

  test("maps non-error OpenRouter failures to a generic fallback error", async () => {
    state.fetchModelsError = null;
    const { fetchModels } = await import("@/lib/models");
    vi.mocked(fetchModels).mockImplementationOnce(async () => {
      throw "unexpected";
    });

    const { GET } = await import("../src/app/api/models/route");
    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "OpenRouter error",
      code: "OPENROUTER_ERROR",
    });
  });
});
