import { beforeEach, test } from "vitest";
import assert from "node:assert/strict";
import { resolvePromptVisibility } from "../src/lib/prompts";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.GLOBAL_ADMIN_EMAILS;
});

test("resolvePromptVisibility: allows GLOBAL for global admins only", () => {
  process.env.GLOBAL_ADMIN_EMAILS = "admin@example.com";

  const result = resolvePromptVisibility("GLOBAL", {
    role: "ADMIN",
    orgId: null,
    email: "admin@example.com",
  });
  assert.equal(result, "GLOBAL");
});

test("resolvePromptVisibility: restricts GLOBAL for org admins without allowlist", () => {
  process.env.GLOBAL_ADMIN_EMAILS = "platform@example.com";

  const result = resolvePromptVisibility("GLOBAL", {
    role: "ADMIN",
    orgId: "org-1",
    email: "org-admin@example.com",
  });
  assert.equal(result, "PRIVATE");
});

test("resolvePromptVisibility: restricts GLOBAL for USER to PRIVATE", () => {
  const result = resolvePromptVisibility("GLOBAL", {
    role: "USER",
    orgId: "some-org",
    email: "user@example.com",
  });
  assert.equal(result, "PRIVATE");
});

test("resolvePromptVisibility: restricts GLOBAL for EMPLOYEE to PRIVATE", () => {
  const result = resolvePromptVisibility("GLOBAL", {
    role: "EMPLOYEE",
    orgId: "some-org",
    email: "employee@example.com",
  });
  assert.equal(result, "PRIVATE");
});

test("resolvePromptVisibility: allows ORG for user with orgId", () => {
  const result = resolvePromptVisibility("ORG", {
    role: "USER",
    orgId: "some-org",
    email: "user@example.com",
  });
  assert.equal(result, "ORG");
});

test("resolvePromptVisibility: restricts ORG to PRIVATE if no orgId", () => {
  const result = resolvePromptVisibility("ORG", {
    role: "USER",
    orgId: null,
    email: "user@example.com",
  });
  assert.equal(result, "PRIVATE");
});

test("resolvePromptVisibility: always allows PRIVATE", () => {
  const result = resolvePromptVisibility("PRIVATE", {
    role: "USER",
    orgId: null,
    email: "user@example.com",
  });
  assert.equal(result, "PRIVATE");
});
