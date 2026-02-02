import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
}));

import {
  applyDlpToText,
  authorizeAiRequest,
} from "@/lib/ai-authorization";
import { getOrgDlpPolicy, getOrgModelPolicy } from "@/lib/org-settings";

describe("Policy enforcement parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("DLP block is consistent between web(text) and telegram(authorizeAiRequest)", async () => {
    const settings = {
      dlpPolicy: {
        enabled: true,
        action: "block",
        patterns: ["secret"],
      },
      modelPolicy: {
        mode: "denylist",
        models: [],
      },
    } as unknown as Prisma.JsonValue;

    const dlpPolicy = getOrgDlpPolicy(settings);

    const web = await applyDlpToText({
      text: "my secret",
      policy: dlpPolicy,
      audit: { orgId: "org-1", actorId: "u1", targetId: "chat-1" },
    });
    expect(web.ok).toBe(false);

    const tg = await authorizeAiRequest("openai/gpt-4o-mini", "my secret", {
      userId: "u1",
      orgId: "org-1",
      settings,
      source: "telegram",
    });
    expect(tg.allowed).toBe(false);
  });

  it("Model denylist blocks consistently", async () => {
    const settings = {
      dlpPolicy: {
        enabled: false,
        action: "block",
        patterns: [],
      },
      modelPolicy: {
        mode: "denylist",
        models: ["openai/gpt-4o-mini"],
      },
    } as unknown as Prisma.JsonValue;

    const policy = getOrgModelPolicy(settings);
    expect(policy.models.length).toBe(1);

    const tg = await authorizeAiRequest("openai/gpt-4o-mini", "hi", {
      userId: "u1",
      orgId: "org-1",
      settings,
      source: "telegram",
    });
    expect(tg.allowed).toBe(false);
  });
});
