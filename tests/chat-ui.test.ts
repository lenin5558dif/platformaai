import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  estimateUsdCost,
  formatPricing,
  getChatGroups,
  getModelCostPerMillion,
  getModelSpeedLabel,
} from "../src/lib/chat-ui";

test("estimateTokens returns at least 1", () => {
  assert.equal(estimateTokens(""), 1);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcdefghi"), 3);
});

test("estimateUsdCost computes price with prompt and completion", () => {
  const cost = estimateUsdCost({
    promptTokens: 1000,
    completionTokens: 500,
    pricing: { prompt: "0.000001", completion: "0.000002" },
  });
  assert.equal(cost, 0.000001 * 1000 + 0.000002 * 500);
});

test("formatPricing handles empty and valid pricing", () => {
  assert.equal(formatPricing(undefined), "—");
  assert.equal(formatPricing({}), "—");
  assert.match(
    formatPricing({ prompt: "0.000001", completion: "0.000002" }),
    /Prompt/,
  );
});

test("getModelCostPerMillion handles missing pricing", () => {
  assert.equal(getModelCostPerMillion({ id: "test" }), Number.POSITIVE_INFINITY);
  assert.equal(
    getModelCostPerMillion({ id: "test", pricing: { prompt: "0.000001" } }),
    1,
  );
});

test("getModelSpeedLabel classifies models", () => {
  assert.equal(getModelSpeedLabel("gpt-4o-mini"), "fast");
  assert.equal(getModelSpeedLabel("claude-3-opus"), "precise");
  assert.equal(getModelSpeedLabel("some-model"), "standard");
});

test("getChatGroups places pinned chats first and groups by date", () => {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12)
  );
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const older = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000);

  const chats = [
    { id: "pinned", pinned: true, updatedAt: older.toISOString() },
    { id: "today", updatedAt: today.toISOString() },
    { id: "yesterday", updatedAt: yesterday.toISOString() },
    { id: "older", updatedAt: older.toISOString() },
  ];

  const groups = getChatGroups(chats);
  const groupMap = new Map(groups.map((group) => [group.label, group.items]));

  assert.ok(groupMap.get("Pinned")?.some((chat) => chat.id === "pinned"));
  assert.ok(groupMap.get("Today")?.some((chat) => chat.id === "today"));
  assert.ok(groupMap.get("Yesterday")?.some((chat) => chat.id === "yesterday"));
  assert.ok(groupMap.get("Older")?.some((chat) => chat.id === "older"));
});
