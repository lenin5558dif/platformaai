import assert from "node:assert/strict";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getModelPricing: vi.fn(),
}));

vi.mock("@/lib/models", () => ({
  getModelPricing: mocks.getModelPricing,
}));

import { getNavItems } from "@/lib/navigation";
import { filterModels, isModelAllowed } from "@/lib/model-policy";
import {
  getOrgDlpPolicy,
  getOrgModelPolicy,
  mergeOrgSettings,
} from "@/lib/org-settings";
import { calculateCreditsFromStt, calculateCreditsFromUsage } from "@/lib/pricing";
import {
  scimGroupResource,
  scimListResponse,
  scimUserResource,
} from "@/lib/scim-responses";

const ORIGINAL_ENV = { ...process.env };

describe("policy and utility coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OPENROUTER_MARKUP;
    delete process.env.USD_PER_CREDIT;
    delete process.env.WHISPER_USD_PER_MINUTE;
  });

  test("model policy allows all when no restrictions are configured", () => {
    const policy = { mode: "denylist" as const, models: [] };
    const models = [{ id: "openai/gpt-4o" }];

    assert.equal(isModelAllowed("openai/gpt-4o", policy), true);
    assert.equal(filterModels(models, policy), models);
  });

  test("model policy normalizes ids for allowlist and denylist modes", () => {
    const allowlist = {
      mode: "allowlist" as const,
      models: [" OpenAI/GPT-4O ", "anthropic/claude-3.7"],
    };
    const denylist = {
      mode: "denylist" as const,
      models: ["OPENAI/GPT-4O"],
    };
    const models = [
      { id: "openai/gpt-4o" },
      { id: "anthropic/claude-3.7" },
      { id: "google/gemini-2.5" },
    ];

    assert.equal(isModelAllowed(" openai/gpt-4o ", allowlist), true);
    assert.equal(isModelAllowed("google/gemini-2.5", allowlist), false);
    expect(filterModels(models, allowlist)).toEqual([
      { id: "openai/gpt-4o" },
      { id: "anthropic/claude-3.7" },
    ]);
    expect(filterModels(models, denylist)).toEqual([
      { id: "anthropic/claude-3.7" },
      { id: "google/gemini-2.5" },
    ]);
  });

  test("org settings return safe defaults and parse structured policies", () => {
    expect(getOrgModelPolicy(null)).toEqual({ mode: "denylist", models: [] });
    expect(getOrgDlpPolicy(["bad-input"] as never)).toEqual({
      enabled: false,
      action: "block",
      patterns: [],
    });

    expect(
      getOrgModelPolicy({
        modelPolicy: {
          mode: "allowlist",
          models: ["openai/gpt-4o", 123, "anthropic/claude-3.7"],
        },
      } as never)
    ).toEqual({
      mode: "allowlist",
      models: ["openai/gpt-4o", "anthropic/claude-3.7"],
    });

    expect(
      getOrgDlpPolicy({
        dlpPolicy: {
          enabled: true,
          action: "redact",
          patterns: ["secret", 42, "passport"],
        },
      } as never)
    ).toEqual({
      enabled: true,
      action: "redact",
      patterns: ["secret", "passport"],
    });
  });

  test("org settings merge patches onto existing values", () => {
    expect(
      mergeOrgSettings(
        { timezone: "UTC", modelPolicy: { mode: "denylist", models: ["a"] } } as never,
        { timezone: "Europe/Moscow", featureFlag: true }
      )
    ).toEqual({
      timezone: "Europe/Moscow",
      modelPolicy: { mode: "denylist", models: ["a"] },
      featureFlag: true,
    });
  });

  test("pricing converts token usage into credits using markup and credit price", async () => {
    process.env.OPENROUTER_MARKUP = "1.5";
    process.env.USD_PER_CREDIT = "0.02";
    mocks.getModelPricing.mockResolvedValue({
      prompt: "0.001",
      completion: "0.002",
    });

    const result = await calculateCreditsFromUsage({
      modelId: "openai/gpt-4o",
      promptTokens: 100,
      completionTokens: 50,
      apiKey: "user-key",
    });

    expect(result.promptUsd).toBeCloseTo(0.1);
    expect(result.completionUsd).toBeCloseTo(0.1);
    expect(result.totalUsd).toBeCloseTo(0.3);
    expect(result.credits).toBeCloseTo(15);

    expect(mocks.getModelPricing).toHaveBeenCalledWith("openai/gpt-4o", "user-key");
  });

  test("pricing falls back when credit price is zero and supports speech-to-text usage", async () => {
    process.env.USD_PER_CREDIT = "0";
    process.env.WHISPER_USD_PER_MINUTE = "0.12";
    mocks.getModelPricing.mockResolvedValue(null);

    await expect(
      calculateCreditsFromUsage({
        modelId: "model-without-pricing",
        promptTokens: 100,
        completionTokens: 50,
      })
    ).resolves.toEqual({
      credits: 0,
      totalUsd: 0,
      promptUsd: 0,
      completionUsd: 0,
    });

    expect(calculateCreditsFromStt({ durationSeconds: 30 })).toEqual({
      credits: 6,
      totalUsd: 0.06,
    });
  });

  test("scim helpers build list, user, and group resources", () => {
    expect(scimListResponse([{ id: "u-1" }], 10)).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 10,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [{ id: "u-1" }],
    });

    expect(
      scimUserResource(
        {
          id: "user-1",
          email: null,
          telegramId: "tg-1",
          isActive: true,
        } as never,
        { id: "cc-1", name: "Finance" } as never
      )
    ).toMatchObject({
      id: "user-1",
      userName: "tg-1",
      displayName: "tg-1",
      emails: [],
      groups: [{ value: "cc-1", display: "Finance" }],
    });

    expect(
      scimGroupResource(
        { id: "cc-1", name: "Finance" } as never,
        [{ id: "user-1" }, { id: "user-2" }] as never
      )
    ).toMatchObject({
      id: "cc-1",
      displayName: "Finance",
      members: [{ value: "user-1" }, { value: "user-2" }],
    });
  });

  test("navigation returns role-specific menu items", () => {
    expect(getNavItems("USER").map((item) => item.href)).toEqual([
      "/",
      "/prompts",
      "/models",
      "/billing",
      "/settings",
      "/pricing",
    ]);

    process.env.GLOBAL_ADMIN_EMAILS = "platform@example.com";

    expect(getNavItems("ADMIN", "org-admin@example.com").map((item) => item.href)).toEqual([
      "/",
      "/prompts",
      "/models",
      "/billing",
      "/settings",
      "/pricing",
      "/org",
      "/timeline",
      "/events",
      "/audit",
    ]);

    expect(getNavItems("ADMIN", "platform@example.com").map((item) => item.href)).toEqual([
      "/",
      "/prompts",
      "/models",
      "/billing",
      "/settings",
      "/pricing",
      "/org",
      "/timeline",
      "/events",
      "/audit",
      "/admin",
    ]);

    expect(getNavItems(null).map((item) => item.href)).toEqual([
      "/",
      "/prompts",
      "/models",
      "/billing",
      "/settings",
      "/pricing",
    ]);

    expect(getNavItems("MEMBER").map((item) => item.href)).toEqual([
      "/",
      "/prompts",
      "/models",
      "/billing",
      "/settings",
      "/pricing",
      "/org",
      "/timeline",
    ]);
  });
});
