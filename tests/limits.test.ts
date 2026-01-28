import { test } from "vitest";
import assert from "node:assert/strict";
import { applyLimitResets, isSameUtcDay, isSameUtcMonth } from "../src/lib/limits";

test("isSameUtcDay matches day boundary", () => {
  const first = new Date(Date.UTC(2024, 0, 1, 0, 1));
  const second = new Date(Date.UTC(2024, 0, 1, 23, 59));
  const third = new Date(Date.UTC(2024, 0, 2, 0, 0));

  assert.equal(isSameUtcDay(first, second), true);
  assert.equal(isSameUtcDay(first, third), false);
});

test("isSameUtcMonth matches month boundary", () => {
  const first = new Date(Date.UTC(2024, 1, 1, 0, 0));
  const second = new Date(Date.UTC(2024, 1, 28, 12, 0));
  const third = new Date(Date.UTC(2024, 2, 1, 0, 0));

  assert.equal(isSameUtcMonth(first, second), true);
  assert.equal(isSameUtcMonth(first, third), false);
});

test("applyLimitResets resets counters when dates change", () => {
  const before = new Date();
  const result = applyLimitResets({
    dailySpent: 10,
    monthlySpent: 25,
    dailyResetAt: new Date(Date.UTC(2020, 0, 1, 0, 0)),
    monthlyResetAt: new Date(Date.UTC(2020, 0, 1, 0, 0)),
  });

  assert.equal(result.dailySpent, 0);
  assert.equal(result.monthlySpent, 0);
  assert.ok(result.dailyResetAt.getTime() >= before.getTime());
  assert.ok(result.monthlyResetAt.getTime() >= before.getTime());
});

test("applyLimitResets keeps counters when dates are current", () => {
  const now = new Date();
  const result = applyLimitResets({
    dailySpent: 5,
    monthlySpent: 12,
    dailyResetAt: now,
    monthlyResetAt: now,
  });

  assert.equal(result.dailySpent, 5);
  assert.equal(result.monthlySpent, 12);
});
