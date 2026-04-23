import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  platformConfig: { disabledModelIds: [] as string[] },
  apiKey: "openrouter-key",
  imageModel: null as null | Record<string, unknown>,
  ownedChat: { id: "chat_1" } as null | Record<string, unknown>,
  providerError: null as null | Error,
  imageGenerationCreate: vi.fn(),
  imageGenerationUpdate: vi.fn(),
  reserveAiQuotaHold: vi.fn(),
  preflightCredits: vi.fn(),
  spendCredits: vi.fn(),
  commitAiQuotaHold: vi.fn(),
  releaseAiQuotaHold: vi.fn(),
  generateImageWithOpenRouter: vi.fn(),
  saveGeneratedImageDataUrl: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => state.user),
    },
    imageGeneration: {
      create: state.imageGenerationCreate,
      update: state.imageGenerationUpdate,
    },
  },
}));

vi.mock("@/lib/platform-config", () => ({
  getPlatformConfig: vi.fn(async () => state.platformConfig),
}));

vi.mock("@/lib/provider-credentials", () => ({
  resolveOpenRouterApiKey: vi.fn(async () => state.apiKey),
}));

vi.mock("@/lib/chat-ownership", () => ({
  findOwnedChat: vi.fn(async () => state.ownedChat),
}));

vi.mock("@/lib/image-models", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/image-models")>(
    "../src/lib/image-models"
  );
  return {
    ...actual,
    getImageModelById: vi.fn(async () => state.imageModel),
  };
});

vi.mock("@/lib/ai-authorization", () => ({
  validateModelPolicy: vi.fn(async () => ({ ok: true })),
  applyDlpToText: vi.fn(async ({ text }: { text: string }) => ({
    ok: true,
    blocked: false,
    redacted: false,
    content: text,
  })),
}));

vi.mock("@/lib/billing", () => ({
  reserveAiQuotaHold: state.reserveAiQuotaHold,
  preflightCredits: state.preflightCredits,
  spendCredits: state.spendCredits,
  commitAiQuotaHold: state.commitAiQuotaHold,
  releaseAiQuotaHold: state.releaseAiQuotaHold,
}));

vi.mock("@/lib/image-generation-provider", () => ({
  generateImageWithOpenRouter: state.generateImageWithOpenRouter,
}));

vi.mock("@/lib/image-storage", () => ({
  saveGeneratedImageDataUrl: state.saveGeneratedImageDataUrl,
}));

vi.mock("@/lib/telemetry", () => ({
  logEvent: vi.fn(async () => {}),
}));

describe("image generation service", () => {
  beforeEach(() => {
    delete process.env.IMAGE_GENERATION_ENABLED;
    state.user = {
      id: "user_1",
      balance: 500,
      costCenterId: null,
      isActive: true,
      orgId: null,
      settings: { billingTier: "tier_500" },
      org: null,
    };
    state.platformConfig = { disabledModelIds: [] };
    state.apiKey = "openrouter-key";
    state.imageModel = {
      id: "paid/image",
      name: "Paid image",
      output_modalities: ["image"],
      pricing: { image: "0.02", prompt: "0", completion: "0" },
    };
    state.ownedChat = { id: "chat_1" };
    state.providerError = null;
    state.imageGenerationCreate.mockReset().mockResolvedValue({
      id: "gen_1",
    });
    state.imageGenerationUpdate.mockReset().mockImplementation(async ({ data }) => ({
      id: "gen_1",
      prompt: "Нарисуй город",
      revisedPrompt: data.revisedPrompt ?? null,
      modelId: "paid/image",
      status: data.status,
      mimeType: data.mimeType ?? null,
      publicUrl: null,
      width: null,
      height: null,
      aspectRatio: "1:1",
      imageSize: "1K",
      cost: { toString: () => String(data.cost ?? 0) },
      tokenCount: 0,
      providerRequestId: data.providerRequestId ?? null,
      error: data.error ?? null,
      createdAt: new Date("2026-04-23T09:00:00.000Z"),
      updatedAt: new Date("2026-04-23T09:00:01.000Z"),
    }));
    state.reserveAiQuotaHold.mockReset().mockResolvedValue(null);
    state.preflightCredits.mockReset().mockResolvedValue(undefined);
    state.spendCredits.mockReset().mockResolvedValue(undefined);
    state.commitAiQuotaHold.mockReset().mockResolvedValue(undefined);
    state.releaseAiQuotaHold.mockReset().mockResolvedValue(undefined);
    state.generateImageWithOpenRouter.mockReset().mockResolvedValue({
      id: "or_gen_1",
      content: "Готово",
      images: [{ dataUrl: "data:image/png;base64,aGVsbG8=", index: 0 }],
      raw: {},
    });
    state.saveGeneratedImageDataUrl.mockReset().mockResolvedValue({
      storagePath: "/tmp/gen_1.png",
      mimeType: "image/png",
      size: 5,
    });
    vi.clearAllMocks();
  });

  test("generates, stores and bills a paid image", async () => {
    const { generateImageForUser } = await import("../src/lib/image-generation");

    const result = await generateImageForUser({
      userId: "user_1",
      prompt: "Нарисуй город",
      chatId: "chat_1",
      aspectRatio: "1:1",
      imageSize: "1K",
    });

    expect(state.reserveAiQuotaHold).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", amount: 4 })
    );
    expect(state.preflightCredits).toHaveBeenCalledWith({
      userId: "user_1",
      minAmount: 4,
    });
    expect(state.generateImageWithOpenRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "openrouter-key",
        modelId: "paid/image",
        prompt: "Нарисуй город",
      })
    );
    expect(state.saveGeneratedImageDataUrl).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", generationId: "gen_1" })
    );
    expect(state.spendCredits).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1", amount: 4 })
    );
    expect(state.commitAiQuotaHold).toHaveBeenCalledWith({
      hold: null,
      finalAmount: 4,
    });
    expect(result.data).toMatchObject({
      id: "gen_1",
      status: "COMPLETED",
      cost: "4",
    });
  });

  test("blocks paid image models on free tier", async () => {
    state.user = {
      ...state.user,
      balance: 0,
      settings: { billingTier: "free" },
    };
    const { generateImageForUser } = await import("../src/lib/image-generation");

    await expect(
      generateImageForUser({
        userId: "user_1",
        prompt: "Нарисуй город",
      })
    ).rejects.toMatchObject({
      status: 402,
      code: "PAID_IMAGE_MODEL_REQUIRED",
    });
    expect(state.imageGenerationCreate).not.toHaveBeenCalled();
    expect(state.generateImageWithOpenRouter).not.toHaveBeenCalled();
  });

  test("marks generation as failed and releases quota on provider error", async () => {
    state.generateImageWithOpenRouter.mockRejectedValueOnce(new Error("provider down"));
    const { generateImageForUser } = await import("../src/lib/image-generation");

    await expect(
      generateImageForUser({
        userId: "user_1",
        prompt: "Нарисуй город",
      })
    ).rejects.toMatchObject({
      status: 502,
      code: "IMAGE_GENERATION_FAILED",
    });

    expect(state.spendCredits).not.toHaveBeenCalled();
    expect(state.releaseAiQuotaHold).toHaveBeenCalledWith({ hold: null });
    expect(state.imageGenerationUpdate).toHaveBeenCalledWith({
      where: { id: "gen_1" },
      data: {
        status: "FAILED",
        error: "provider down",
      },
    });
  });

  test("respects the image generation feature flag", async () => {
    process.env.IMAGE_GENERATION_ENABLED = "0";
    const { generateImageForUser } = await import("../src/lib/image-generation");

    await expect(
      generateImageForUser({
        userId: "user_1",
        prompt: "Нарисуй город",
      })
    ).rejects.toMatchObject({
      status: 503,
      code: "IMAGE_GENERATION_DISABLED",
    });

    expect(state.imageGenerationCreate).not.toHaveBeenCalled();
    expect(state.generateImageWithOpenRouter).not.toHaveBeenCalled();
  });
});
