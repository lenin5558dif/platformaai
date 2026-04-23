import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  user: null as null | Record<string, unknown>,
  platformConfig: { disabledModelIds: [] as string[] },
  apiKey: "openrouter-key",
  models: [] as Array<Record<string, unknown>>,
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
  resolveOpenRouterApiKey: vi.fn(async () => state.apiKey),
}));

vi.mock("@/lib/image-models", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/image-models")>(
    "../src/lib/image-models"
  );
  return {
    ...actual,
    fetchImageModels: vi.fn(async () => state.models),
  };
});

describe("api images models route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.user = {
      id: "user_1",
      balance: 0,
      orgId: null,
      settings: { billingTier: "free" },
      org: null,
    };
    state.platformConfig = { disabledModelIds: ["disabled/free"] };
    state.apiKey = "openrouter-key";
    state.models = [
      {
        id: "free/image",
        name: "Free Image",
        output_modalities: ["image"],
        pricing: { prompt: "0", completion: "0" },
      },
      {
        id: "paid/image",
        name: "Paid Image",
        output_modalities: ["image"],
        pricing: { image: "0.02" },
      },
      {
        id: "disabled/free",
        name: "Disabled",
        output_modalities: ["image"],
        pricing: { prompt: "0", completion: "0" },
      },
    ];
  });

  test("returns 401 without session", async () => {
    state.authenticated = false;
    const { GET } = await import("../src/app/api/images/models/route");

    const res = await GET();

    expect(res.status).toBe(401);
  });

  test("does not expose image models for free tier", async () => {
    const { GET } = await import("../src/app/api/images/models/route");

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      data: [],
      message: "Генерация изображений доступна только на платном тарифе.",
      code: "IMAGE_GENERATION_REQUIRES_PAID_TIER",
    });
  });

  test("returns paid image models for paid tier", async () => {
    state.user = {
      ...state.user,
      balance: 500,
      settings: { billingTier: "tier_500" },
    };
    const { GET } = await import("../src/app/api/images/models/route");

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.map((model: { id: string }) => model.id)).toEqual([
      "free/image",
      "paid/image",
    ]);
  });
});
