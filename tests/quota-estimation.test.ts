import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { vi } from "vitest";

// Mock the models module before importing the module under test
vi.mock("@/lib/models", () => ({
  getModelPricing: vi.fn(),
}));

import {
  estimateChatPromptTokens,
  estimateTokensFromText,
  estimateUpperBoundCredits,
} from "../src/lib/quota-estimation";
import { getModelPricing } from "@/lib/models";
import { DEFAULT_MAX_TOKENS } from "@/lib/quota-manager";

const mockedGetModelPricing = vi.mocked(getModelPricing);

beforeEach(() => {
  vi.clearAllMocks();
});

test("estimateUpperBoundCredits defaults maxTokens to DEFAULT_MAX_TOKENS (4000) when omitted", async () => {
  // Set deterministic environment variables
  const originalMarkup = process.env.OPENROUTER_MARKUP;
  const originalUsdPerCredit = process.env.USD_PER_CREDIT;
  process.env.OPENROUTER_MARKUP = "1";
  process.env.USD_PER_CREDIT = "0.01";

  // Mock pricing where prompt is more expensive than completion
  mockedGetModelPricing.mockResolvedValue({
    prompt: "0.000002", // $2 per million tokens
    completion: "0.000001", // $1 per million tokens
  });

  const promptTokensEstimate = 1000;
  const result = await estimateUpperBoundCredits({
    modelId: "test-model",
    promptTokensEstimate,
    // maxTokens intentionally omitted
  });

  // Expected calculation:
  // totalTokens = 1000 (prompt) + 4000 (default maxTokens) = 5000
  // usdPerToken = max(0.000002, 0.000001) = 0.000002
  // worstCaseUsd = 5000 * 0.000002 * 1 = 0.01
  // credits = 0.01 / 0.01 = 1
  const expectedTotalTokens = promptTokensEstimate + DEFAULT_MAX_TOKENS;
  const expectedUsdPerToken = 0.000002;
  const expectedWorstCaseUsd = expectedTotalTokens * expectedUsdPerToken * 1;
  const expectedCredits = expectedWorstCaseUsd / 0.01;

  assert.equal(result, expectedCredits);
  assert.equal(DEFAULT_MAX_TOKENS, 4000);

  // Restore environment
  process.env.OPENROUTER_MARKUP = originalMarkup;
  process.env.USD_PER_CREDIT = originalUsdPerCredit;
});

test("estimateUpperBoundCredits uses max(promptUsdPerToken, completionUsdPerToken) for conservative pricing", async () => {
  // Set deterministic environment variables
  const originalMarkup = process.env.OPENROUTER_MARKUP;
  const originalUsdPerCredit = process.env.USD_PER_CREDIT;
  process.env.OPENROUTER_MARKUP = "1.2";
  process.env.USD_PER_CREDIT = "0.005";

  // Mock pricing where completion is more expensive than prompt
  mockedGetModelPricing.mockResolvedValue({
    prompt: "0.000001", // $1 per million tokens
    completion: "0.000003", // $3 per million tokens
  });

  const promptTokensEstimate = 500;
  const maxTokens = 2000;
  const result = await estimateUpperBoundCredits({
    modelId: "test-model",
    promptTokensEstimate,
    maxTokens,
  });

  // Expected calculation:
  // totalTokens = 500 + 2000 = 2500
  // usdPerToken = max(0.000001, 0.000003) = 0.000003 (conservative: uses higher completion price)
  // worstCaseUsd = 2500 * 0.000003 * 1.2 = 0.009
  // credits = 0.009 / 0.005 = 1.8
  const expectedTotalTokens = promptTokensEstimate + maxTokens;
  const expectedUsdPerToken = 0.000003; // max of the two prices
  const expectedWorstCaseUsd = expectedTotalTokens * expectedUsdPerToken * 1.2;
  const expectedCredits = expectedWorstCaseUsd / 0.005;

  assert.equal(result, expectedCredits);

  // Restore environment
  process.env.OPENROUTER_MARKUP = originalMarkup;
  process.env.USD_PER_CREDIT = originalUsdPerCredit;
});

test("estimateUpperBoundCredits uses prompt price when it is higher", async () => {
  // Set deterministic environment variables
  const originalMarkup = process.env.OPENROUTER_MARKUP;
  const originalUsdPerCredit = process.env.USD_PER_CREDIT;
  process.env.OPENROUTER_MARKUP = "1";
  process.env.USD_PER_CREDIT = "0.01";

  // Mock pricing where prompt is more expensive than completion
  mockedGetModelPricing.mockResolvedValue({
    prompt: "0.000005", // $5 per million tokens
    completion: "0.000002", // $2 per million tokens
  });

  const promptTokensEstimate = 1000;
  const maxTokens = 1000;
  const result = await estimateUpperBoundCredits({
    modelId: "test-model",
    promptTokensEstimate,
    maxTokens,
  });

  // Expected calculation:
  // totalTokens = 1000 + 1000 = 2000
  // usdPerToken = max(0.000005, 0.000002) = 0.000005 (conservative: uses higher prompt price)
  // worstCaseUsd = 2000 * 0.000005 * 1 = 0.01
  // credits = 0.01 / 0.01 = 1
  const expectedTotalTokens = promptTokensEstimate + maxTokens;
  const expectedUsdPerToken = 0.000005; // max of the two prices
  const expectedWorstCaseUsd = expectedTotalTokens * expectedUsdPerToken * 1;
  const expectedCredits = expectedWorstCaseUsd / 0.01;

  assert.equal(result, expectedCredits);

  // Restore environment
  process.env.OPENROUTER_MARKUP = originalMarkup;
  process.env.USD_PER_CREDIT = originalUsdPerCredit;
});

test("estimateUpperBoundCredits formula: (promptTokensEstimate + maxTokens) * max(promptUsdPerToken, completionUsdPerToken) * OPENROUTER_MARKUP / USD_PER_CREDIT", async () => {
  // Set deterministic environment variables
  const originalMarkup = process.env.OPENROUTER_MARKUP;
  const originalUsdPerCredit = process.env.USD_PER_CREDIT;
  process.env.OPENROUTER_MARKUP = "1.5";
  process.env.USD_PER_CREDIT = "0.002";

  // Use equal pricing to simplify verification
  mockedGetModelPricing.mockResolvedValue({
    prompt: "0.00001", // $10 per million tokens
    completion: "0.00001",
  });

  const promptTokensEstimate = 2000;
  const maxTokens = 3000;
  const result = await estimateUpperBoundCredits({
    modelId: "test-model",
    promptTokensEstimate,
    maxTokens,
  });

  // Expected calculation:
  // totalTokens = 2000 + 3000 = 5000
  // usdPerToken = max(0.00001, 0.00001) = 0.00001
  // worstCaseUsd = 5000 * 0.00001 * 1.5 = 0.075
  // credits = 0.075 / 0.002 = 37.5
  const expectedTotalTokens = promptTokensEstimate + maxTokens;
  const expectedUsdPerToken = 0.00001;
  const openRouterMarkup = 1.5;
  const usdPerCredit = 0.002;
  const expectedWorstCaseUsd = expectedTotalTokens * expectedUsdPerToken * openRouterMarkup;
  const expectedCredits = expectedWorstCaseUsd / usdPerCredit;

  assert.equal(result, expectedCredits);

  // Restore environment
  process.env.OPENROUTER_MARKUP = originalMarkup;
  process.env.USD_PER_CREDIT = originalUsdPerCredit;
});

test("estimateUpperBoundCredits handles missing pricing by defaulting to 0", async () => {
  // Set deterministic environment variables
  const originalMarkup = process.env.OPENROUTER_MARKUP;
  const originalUsdPerCredit = process.env.USD_PER_CREDIT;
  process.env.OPENROUTER_MARKUP = "1";
  process.env.USD_PER_CREDIT = "0.01";

  // Mock null pricing (model not found)
  mockedGetModelPricing.mockResolvedValue(null);

  const promptTokensEstimate = 1000;
  const maxTokens = 1000;
  const result = await estimateUpperBoundCredits({
    modelId: "unknown-model",
    promptTokensEstimate,
    maxTokens,
  });

  // Expected calculation with 0 pricing:
  // totalTokens = 1000 + 1000 = 2000
  // usdPerToken = max(0, 0) = 0
  // worstCaseUsd = 2000 * 0 * 1 = 0
  // credits = 0 / 0.01 = 0
  assert.equal(result, 0);

  // Restore environment
  process.env.OPENROUTER_MARKUP = originalMarkup;
  process.env.USD_PER_CREDIT = originalUsdPerCredit;
});

test("estimateUpperBoundCredits passes apiKey to getModelPricing", async () => {
  process.env.OPENROUTER_MARKUP = "1";
  process.env.USD_PER_CREDIT = "0.01";

  mockedGetModelPricing.mockResolvedValue({
    prompt: "0.000001",
    completion: "0.000001",
  });

  const apiKey = "test-api-key-123";
  await estimateUpperBoundCredits({
    modelId: "test-model",
    promptTokensEstimate: 100,
    maxTokens: 100,
    apiKey,
  });

  assert.equal(mockedGetModelPricing.mock.calls.length, 1);
  assert.equal(mockedGetModelPricing.mock.calls[0][0], "test-model");
  assert.equal(mockedGetModelPricing.mock.calls[0][1], apiKey);
});

test("estimateUpperBoundCredits uses x2 markup by default", async () => {
  const originalMarkup = process.env.OPENROUTER_MARKUP;
  const originalUsdPerCredit = process.env.USD_PER_CREDIT;
  delete process.env.OPENROUTER_MARKUP;
  process.env.USD_PER_CREDIT = "0.01";

  mockedGetModelPricing.mockResolvedValue({
    prompt: "0.000001",
    completion: "0.000001",
  });

  const result = await estimateUpperBoundCredits({
    modelId: "test-model",
    promptTokensEstimate: 1000,
    maxTokens: 1000,
  });

  const expectedWorstCaseUsd = 2000 * 0.000001 * 2;
  const expectedCredits = expectedWorstCaseUsd / 0.01;

  assert.equal(result, expectedCredits);

  if (originalMarkup === undefined) {
    delete process.env.OPENROUTER_MARKUP;
  } else {
    process.env.OPENROUTER_MARKUP = originalMarkup;
  }
  if (originalUsdPerCredit === undefined) {
    delete process.env.USD_PER_CREDIT;
  } else {
    process.env.USD_PER_CREDIT = originalUsdPerCredit;
  }
});

test("estimateTokensFromText and estimateChatPromptTokens handle non-string content safely", () => {
  assert.equal(estimateTokensFromText("12345678"), 2);

  const circular: { self?: unknown } = {};
  circular.self = circular;

  const result = estimateChatPromptTokens([
    { content: "hello" },
    { content: { nested: true } },
    { content: circular },
  ]);

  assert.equal(result, 6);
});

test("estimateUpperBoundCredits falls back on invalid env values and zero usdPerCredit", async () => {
  const originalMarkup = process.env.OPENROUTER_MARKUP;
  const originalUsdPerCredit = process.env.USD_PER_CREDIT;
  process.env.OPENROUTER_MARKUP = "not-a-number";
  process.env.USD_PER_CREDIT = "0";

  mockedGetModelPricing.mockResolvedValue({
    prompt: "0.000002",
    completion: "0.000001",
  });

  const result = await estimateUpperBoundCredits({
    modelId: "test-model",
    promptTokensEstimate: 1000,
    maxTokens: 1000,
  });

  assert.equal(result, 0.008);

  if (originalMarkup === undefined) {
    delete process.env.OPENROUTER_MARKUP;
  } else {
    process.env.OPENROUTER_MARKUP = originalMarkup;
  }
  if (originalUsdPerCredit === undefined) {
    delete process.env.USD_PER_CREDIT;
  } else {
    process.env.USD_PER_CREDIT = originalUsdPerCredit;
  }
});
