import { test } from "vitest";
import assert from "node:assert/strict";
import { checkRateLimit } from "../src/lib/rate-limit";

test("checkRateLimit enforces limits within a window", async () => {
  const key = `test:${Date.now()}:${Math.random()}`;

  const first = await checkRateLimit({ key, limit: 2, windowMs: 1000 });
  assert.equal(first.ok, true);
  assert.equal(first.remaining, 1);

  const second = await checkRateLimit({ key, limit: 2, windowMs: 1000 });
  assert.equal(second.ok, true);
  assert.equal(second.remaining, 0);

  const third = await checkRateLimit({ key, limit: 2, windowMs: 1000 });
  assert.equal(third.ok, false);
  assert.equal(third.remaining, 0);
});
