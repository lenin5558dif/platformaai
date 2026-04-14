import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
  fetchModels: vi.fn(),
  getUserOpenRouterKey: vi.fn(),
  getOrgModelPolicy: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/models", () => ({
  fetchModels: mocks.fetchModels,
}));

vi.mock("@/lib/user-settings", () => ({
  getUserOpenRouterKey: mocks.getUserOpenRouterKey,
}));

vi.mock("@/lib/org-settings", () => ({
  getOrgModelPolicy: mocks.getOrgModelPolicy,
}));

import { GET } from "@/app/api/models/route";

const ORIGINAL_ENV = { ...process.env };

describe("GET /api/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUTH_BYPASS;
    delete process.env.ALLOW_USER_OPENROUTER_KEYS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("returns 401 when the request is unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.fetchModels).not.toHaveBeenCalled();
  });

  test("uses the user OpenRouter key and applies an allowlist policy when enabled", async () => {
    process.env.ALLOW_USER_OPENROUTER_KEYS = "1";

    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: { openrouterApiKey: "user-key" },
      org: {
        settings: {
          modelPolicy: {
            mode: "allowlist",
            models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
          },
        },
      },
    });
    mocks.getUserOpenRouterKey.mockReturnValue("user-key");
    mocks.getOrgModelPolicy.mockReturnValue({
      mode: "allowlist",
      models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
    });
    mocks.fetchModels.mockResolvedValue([
      { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
      { id: "anthropic/claude-3-opus", name: "Claude 3 Opus" },
    ]);

    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        data: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }],
      },
    });
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { settings: true, org: { select: { settings: true } } },
    });
    expect(mocks.getUserOpenRouterKey).toHaveBeenCalledWith({
      openrouterApiKey: "user-key",
    });
    expect(mocks.getOrgModelPolicy).toHaveBeenCalledWith({
      modelPolicy: {
        mode: "allowlist",
        models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
      },
    });
    expect(mocks.fetchModels).toHaveBeenCalledWith({ apiKey: "user-key" });
  });

  test("skips the user key and applies a denylist policy when OpenRouter keys are not allowed", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-2" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: { openrouterApiKey: "user-key" },
      org: {
        settings: {
          modelPolicy: {
            mode: "denylist",
            models: ["anthropic/claude-3-opus"],
          },
        },
      },
    });
    mocks.getOrgModelPolicy.mockReturnValue({
      mode: "denylist",
      models: ["anthropic/claude-3-opus"],
    });
    mocks.fetchModels.mockResolvedValue([
      { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
      { id: "anthropic/claude-3-opus", name: "Claude 3 Opus" },
    ]);

    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        data: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }],
      },
    });
    expect(mocks.getUserOpenRouterKey).not.toHaveBeenCalled();
    expect(mocks.fetchModels).toHaveBeenCalledWith({ apiKey: undefined });
  });

  test("returns 401 when the OpenRouter fetch fails because no API key is available", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-3" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: null,
      org: { settings: null },
    });
    mocks.getOrgModelPolicy.mockReturnValue({
      mode: "denylist",
      models: [],
    });
    mocks.fetchModels.mockRejectedValue(new Error("OPENROUTER_API_KEY is not set"));

    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "OPENROUTER_API_KEY is not set",
    });
  });

  test("returns 500 for unexpected fetch failures", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-4" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: null,
      org: { settings: null },
    });
    mocks.getOrgModelPolicy.mockReturnValue({
      mode: "denylist",
      models: [],
    });
    mocks.fetchModels.mockRejectedValue(new Error("network down"));

    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "network down",
    });
  });

  test("uses the generic OpenRouter error message when the rejection is not an Error", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-5" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: null,
      org: { settings: null },
    });
    mocks.getOrgModelPolicy.mockReturnValue({
      mode: "denylist",
      models: [],
    });
    mocks.fetchModels.mockRejectedValue("timeout");

    const response = await GET(new Request("http://localhost/api/models"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "OpenRouter error",
    });
  });
});
