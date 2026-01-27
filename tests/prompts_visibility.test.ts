import test from "node:test";
import assert from "node:assert/strict";
import { resolvePromptVisibility } from "../src/lib/prompts";

test("resolvePromptVisibility: allows GLOBAL for ADMIN", () => {
  const result = resolvePromptVisibility("GLOBAL", {
    role: "ADMIN",
    orgId: null,
  });
  assert.equal(result, "GLOBAL");
});

test("resolvePromptVisibility: restricts GLOBAL for USER to PRIVATE", () => {
  const result = resolvePromptVisibility("GLOBAL", {
    role: "USER",
    orgId: "some-org",
  });
  assert.equal(result, "PRIVATE");
});

test("resolvePromptVisibility: restricts GLOBAL for EMPLOYEE to PRIVATE", () => {
  const result = resolvePromptVisibility("GLOBAL", {
    role: "EMPLOYEE",
    orgId: "some-org",
  });
  assert.equal(result, "PRIVATE");
});

test("resolvePromptVisibility: allows ORG for user with orgId", () => {
  const result = resolvePromptVisibility("ORG", {
    role: "USER",
    orgId: "some-org",
  });
  assert.equal(result, "ORG");
});

test("resolvePromptVisibility: restricts ORG to PRIVATE if no orgId", () => {
  const result = resolvePromptVisibility("ORG", {
    role: "USER",
    orgId: null,
  });
  assert.equal(result, "PRIVATE");
});

test("resolvePromptVisibility: always allows PRIVATE", () => {
  const result = resolvePromptVisibility("PRIVATE", {
    role: "USER",
    orgId: null,
  });
  assert.equal(result, "PRIVATE");
});
