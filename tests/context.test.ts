import test from "node:test";
import assert from "node:assert/strict";
import { trimMessages } from "../src/lib/context";

test("trimMessages keeps system messages and trims oldest dialogue", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "1234" },
    { role: "assistant", content: "1234" },
    { role: "user", content: "12345678" },
    { role: "assistant", content: "12345678" },
  ];

  const result = trimMessages(messages, 3);

  assert.equal(result.length, 2);
  assert.equal(result[0].role, "system");
  assert.equal(result[1].content, "12345678");
});

test("trimMessages returns all messages when under limit", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "1234" },
    { role: "assistant", content: "1234" },
  ];

  const result = trimMessages(messages, 10);

  assert.equal(result.length, 3);
  assert.equal(result[1].role, "user");
  assert.equal(result[2].role, "assistant");
});
