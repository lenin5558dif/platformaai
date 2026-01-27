import test from "node:test";
import assert from "node:assert/strict";
import { requestSchema } from "../src/lib/chat-request-schema";
import { mapBillingError } from "../src/lib/billing-errors";

test("requestSchema требует chatId", () => {
  const result = requestSchema.safeParse({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((issue) => issue.path[0] === "chatId"));
  }
});

test("requestSchema принимает chatId", () => {
  const result = requestSchema.safeParse({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    chatId: "chat_123",
  });

  assert.equal(result.success, true);
});

test("mapBillingError возвращает ошибку для insufficient balance", () => {
  const result = mapBillingError("INSUFFICIENT_BALANCE");

  assert.equal(result.status, 402);
  assert.equal(result.error, "Insufficient balance");
});

test("mapBillingError возвращает ошибку по умолчанию", () => {
  const result = mapBillingError("UNKNOWN_ERROR");

  assert.equal(result.status, 500);
  assert.equal(result.error, "Billing error");
});
