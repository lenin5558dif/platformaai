import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_BILLING_MARKUP,
  applyMarkup,
  formatCredits,
  formatCreditsLabel,
  formatModelPricing,
  formatPricePerMillion,
  formatSignedCredits,
  formatTransactionDirection,
} from "../src/lib/billing-display";

vi.mock("@/lib/models", () => ({
  getModelPricing: vi.fn(),
}));

describe("billing display", () => {
  test("formats credits and labels safely", () => {
    expect(formatCredits(null)).toBe("0.00");
    expect(formatCredits(undefined)).toBe("0.00");
    expect(formatCredits("oops")).toBe("0.00");
    expect(formatCredits("12.345")).toBe("12.35");
    expect(formatCreditsLabel(15)).toBe("15.00 кредитов");
    expect(formatSignedCredits("7.5", "-")).toBe("-7.50");
  });

  test("formats prices with and without markup", () => {
    expect(formatPricePerMillion()).toBe("—");
    expect(formatPricePerMillion("")).toBe("—");
    expect(formatPricePerMillion("bad")).toBe("—");
    expect(formatPricePerMillion("0.0000004", 1)).toBe("$0.4000/1M");
    expect(formatPricePerMillion("0.000002")).toContain("$2.000/1M");
    expect(formatPricePerMillion("0.000002", 1)).toBe("$2.000/1M");
    expect(formatPricePerMillion("0.000002", DEFAULT_BILLING_MARKUP)).toContain(
      "$4.000/1M"
    );
    expect(formatPricePerMillion("0.000015", DEFAULT_BILLING_MARKUP)).toContain(
      "$30.00/1M"
    );
  });

  test("formats model pricing and transaction direction", () => {
    expect(formatModelPricing()).toBe("—");
    expect(formatModelPricing({ prompt: "0.000001" }, 1)).toContain("Prompt $1.000/1M");
    expect(
      formatModelPricing({
        prompt: "0.000001",
        completion: "0.000003",
      })
    ).toContain("Prompt");
    expect(applyMarkup(10)).toBe(20);
    expect(formatTransactionDirection("REFILL")).toBe("Пополнение");
    expect(formatTransactionDirection("SPEND")).toBe("Списание");
  });
});

describe("pricing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  test("calculates credits from usage with default markup", async () => {
    const { getModelPricing } = await import("@/lib/models");
    vi.mocked(getModelPricing).mockResolvedValue({
      prompt: "0.000001",
      completion: "0.000002",
    } as any);

    const { calculateCreditsFromUsage } = await import("../src/lib/pricing");
    const result = await calculateCreditsFromUsage({
      modelId: "test-model",
      promptTokens: 1000,
      completionTokens: 500,
    });

    expect(result.promptUsd).toBeCloseTo(0.001);
    expect(result.completionUsd).toBeCloseTo(0.001);
    expect(result.totalUsd).toBeCloseTo(0.004);
    expect(result.credits).toBeCloseTo(0.4);
  });

  test("uses env overrides for usage and stt calculations", async () => {
    const { getModelPricing } = await import("@/lib/models");
    vi.mocked(getModelPricing).mockResolvedValue({
      prompt: "0.000001",
      completion: "0.000001",
    } as any);
    vi.stubEnv("OPENROUTER_MARKUP", "3");
    vi.stubEnv("USD_PER_CREDIT", "0.02");
    vi.stubEnv("WHISPER_USD_PER_MINUTE", "0.03");

    const { calculateCreditsFromUsage, calculateCreditsFromStt } = await import(
      "../src/lib/pricing"
    );
    const usage = await calculateCreditsFromUsage({
      modelId: "test-model",
      promptTokens: 1000,
      completionTokens: 1000,
    });
    const stt = calculateCreditsFromStt({ durationSeconds: 120 });

    expect(usage.totalUsd).toBeCloseTo(0.006);
    expect(usage.credits).toBeCloseTo(0.3);
    expect(stt.totalUsd).toBeCloseTo(0.18);
    expect(stt.credits).toBeCloseTo(9);
  });

  test("handles missing pricing values and zero usd-per-credit fallbacks", async () => {
    const { getModelPricing } = await import("@/lib/models");
    vi.mocked(getModelPricing).mockResolvedValue({
      prompt: undefined,
      completion: "0.000001",
    } as any);
    vi.stubEnv("OPENROUTER_MARKUP", "2");
    vi.stubEnv("USD_PER_CREDIT", "0");
    vi.stubEnv("WHISPER_USD_PER_MINUTE", "0.006");

    const { calculateCreditsFromUsage, calculateCreditsFromStt } = await import(
      "../src/lib/pricing"
    );
    const usage = await calculateCreditsFromUsage({
      modelId: "test-model",
      promptTokens: 1000,
      completionTokens: 1000,
    });
    const stt = calculateCreditsFromStt({ durationSeconds: 30 });

    expect(usage.promptUsd).toBe(0);
    expect(usage.completionUsd).toBeCloseTo(0.001);
    expect(usage.totalUsd).toBeCloseTo(0.002);
    expect(usage.credits).toBeCloseTo(0.2);
    expect(stt.totalUsd).toBeCloseTo(0.006);
    expect(stt.credits).toBeCloseTo(0.6);
  });
});
