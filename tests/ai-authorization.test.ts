import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  logAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: state.logAudit,
}));

import {
  applyDlpToMessages,
  applyDlpToText,
  authorizeAiRequest,
  checkDlpPolicy,
  checkModelAllowed,
  filterFallbackModels,
  validateModelPolicy,
} from "@/lib/ai-authorization";

describe("ai authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("validateModelPolicy allows permitted models and audits blocks", async () => {
    const allowed = await validateModelPolicy({
      modelId: "openai/gpt-4o",
      policy: { mode: "denylist", models: ["anthropic/claude-3.7"] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(allowed).toEqual({ ok: true });

    const blocked = await validateModelPolicy({
      modelId: "openai/gpt-4o",
      policy: { mode: "denylist", models: ["openai/gpt-4o"] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(blocked).toEqual({
      ok: false,
      status: 403,
      error: "Модель запрещена политикой организации.",
    });
    expect(state.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "POLICY_BLOCKED",
        targetType: "model",
        targetId: "openai/gpt-4o",
      })
    );
  });

  test("filterFallbackModels keeps only allowed ids", () => {
    expect(
      filterFallbackModels(
        ["openai/gpt-4o", "anthropic/claude-3.7"],
        { mode: "allowlist", models: ["anthropic/claude-3.7"] }
      )
    ).toEqual(["anthropic/claude-3.7"]);
  });

  test("applyDlpToText handles allow, block, and redact", async () => {
    const allow = await applyDlpToText({
      text: "hello world",
      policy: { enabled: false, action: "block", patterns: [] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(allow).toEqual({
      ok: true,
      blocked: false,
      redacted: false,
      content: "hello world",
    });

    const blocked = await applyDlpToText({
      text: "my secret",
      policy: { enabled: true, action: "block", patterns: ["secret"] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(blocked).toEqual({
      ok: false,
      blocked: true,
      status: 400,
      error: "Запрос отклонен политикой DLP.",
      matches: ["secret"],
    });

    const redacted = await applyDlpToText({
      text: "my secret",
      policy: { enabled: true, action: "redact", patterns: ["secret"] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(redacted).toEqual({
      ok: true,
      blocked: false,
      redacted: true,
      content: "my [REDACTED]",
    });
  });

  test("applyDlpToMessages handles mixed roles, block, and redaction", async () => {
    const allow = await applyDlpToMessages({
      messages: [
        { role: "system", content: "keep" },
        { role: "assistant", content: "ok" },
      ],
      policy: { enabled: false, action: "block", patterns: [] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(allow).toEqual({
      ok: true,
      blocked: false,
      redacted: false,
      messages: [
        { role: "system", content: "keep" },
        { role: "assistant", content: "ok" },
      ],
    });

    const blocked = await applyDlpToMessages({
      messages: [
        { role: "system", content: "keep" },
        { role: "user", content: "secret" },
        { role: "assistant", content: "later" },
      ],
      policy: { enabled: true, action: "block", patterns: ["secret"] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.matches).toEqual(["secret"]);

    const redacted = await applyDlpToMessages({
      messages: [
        { role: "system", content: "keep" },
        { role: "user", content: "my secret" },
        { role: "assistant", content: "later" },
      ],
      policy: { enabled: true, action: "redact", patterns: ["secret"] },
      audit: { orgId: "org_1", actorId: "user_1", targetId: "chat_1" },
    });
    expect(redacted).toEqual({
      ok: true,
      blocked: false,
      redacted: true,
      messages: [
        { role: "system", content: "keep" },
        { role: "user", content: "my [REDACTED]" },
        { role: "assistant", content: "later" },
      ],
    });
  });

  test("checkModelAllowed and checkDlpPolicy cover telegram paths", async () => {
    const modelAllowed = await checkModelAllowed("openai/gpt-4o", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        modelPolicy: { mode: "denylist", models: ["anthropic/claude-3.7"] },
      } as never,
      source: "telegram",
    });
    expect(modelAllowed).toEqual({ allowed: true });

    const modelBlocked = await checkModelAllowed("openai/gpt-4o", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        modelPolicy: { mode: "denylist", models: ["openai/gpt-4o"] },
      } as never,
      source: "telegram",
    });
    expect(modelBlocked).toEqual({ allowed: false, reason: "model_blocked" });

    const dlpAllowed = await checkDlpPolicy("hello", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        dlpPolicy: { enabled: false, action: "block", patterns: [] },
      } as never,
      source: "telegram",
    });
    expect(dlpAllowed).toEqual({ action: "allow" });

    const dlpBlocked = await checkDlpPolicy("secret", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        dlpPolicy: { enabled: true, action: "block", patterns: ["secret"] },
      } as never,
      source: "telegram",
    });
    expect(dlpBlocked).toEqual({ action: "block", matches: ["secret"] });

    const dlpRedacted = await checkDlpPolicy("secret", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        dlpPolicy: { enabled: true, action: "redact", patterns: ["secret"] },
      } as never,
      source: "telegram",
    });
    expect(dlpRedacted).toEqual({
      action: "redact",
      redactedText: "[REDACTED]",
      matches: ["secret"],
    });
  });

  test("authorizeAiRequest returns model and dlp block reasons or final content", async () => {
    const allowed = await authorizeAiRequest("openai/gpt-4o", "hello", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        modelPolicy: { mode: "denylist", models: [] },
        dlpPolicy: { enabled: false, action: "block", patterns: [] },
      } as never,
      source: "telegram",
    });
    expect(allowed).toEqual({ allowed: true, finalContent: "hello" });

    const modelBlocked = await authorizeAiRequest("openai/gpt-4o", "hello", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        modelPolicy: { mode: "denylist", models: ["openai/gpt-4o"] },
        dlpPolicy: { enabled: false, action: "block", patterns: [] },
      } as never,
      source: "telegram",
    });
    expect(modelBlocked).toEqual({ allowed: false, reason: "model_blocked" });

    const dlpBlocked = await authorizeAiRequest("openai/gpt-4o", "secret", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        modelPolicy: { mode: "denylist", models: [] },
        dlpPolicy: { enabled: true, action: "block", patterns: ["secret"] },
      } as never,
      source: "telegram",
    });
    expect(dlpBlocked).toEqual({ allowed: false, reason: "dlp_blocked" });

    const redacted = await authorizeAiRequest("openai/gpt-4o", "secret", {
      userId: "user_1",
      orgId: "org_1",
      settings: {
        modelPolicy: { mode: "denylist", models: [] },
        dlpPolicy: { enabled: true, action: "redact", patterns: ["secret"] },
      } as never,
      source: "telegram",
    });
    expect(redacted).toEqual({ allowed: true, finalContent: "[REDACTED]" });
  });
});
