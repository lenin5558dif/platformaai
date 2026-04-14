import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    chat: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    eventLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/openrouter", () => ({
  getOpenRouterBaseUrl: vi.fn(() => "https://openrouter.ai/api/v1"),
  getOpenRouterHeaders: vi.fn((apiKeyOverride?: string) => ({
    Authorization: `Bearer ${apiKeyOverride ?? "env-key"}`,
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "PlatformaAI",
    "Content-Type": "application/json",
  })),
}));

import { mapBillingError } from "../src/lib/billing-errors";
import { searchWeb } from "../src/lib/search";
import { updateChatSummary } from "../src/lib/summary";
import { logEvent } from "../src/lib/telemetry";
import {
  getSettingsObject,
  getUserAssistantInstructions,
  getUserGoal,
  getUserOnboarded,
  getUserOpenRouterKey,
  getUserProfile,
  getUserTone,
  mergeSettings,
  removeSettingsKey,
} from "../src/lib/user-settings";

describe("low-level lib utilities coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_CHAT_SUMMARY;
    delete process.env.LOG_EVENTS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("billing error mapping covers known codes and fallback", () => {
    expect(mapBillingError("INSUFFICIENT_BALANCE")).toEqual({
      status: 402,
      error: "Insufficient balance",
    });
    expect(mapBillingError("DAILY_LIMIT_EXCEEDED")).toEqual({
      status: 409,
      error: "Daily limit exceeded",
    });
    expect(mapBillingError("MONTHLY_LIMIT_EXCEEDED")).toEqual({
      status: 409,
      error: "Monthly limit exceeded",
    });
    expect(mapBillingError("ORG_BUDGET_EXCEEDED")).toEqual({
      status: 409,
      error: "Organization budget exceeded",
    });
    expect(mapBillingError("COST_CENTER_BUDGET_EXCEEDED")).toEqual({
      status: 409,
      error: "Cost center budget exceeded",
    });
    expect(mapBillingError("USER_NOT_FOUND")).toEqual({
      status: 404,
      error: "User not found",
    });
    expect(mapBillingError("UNKNOWN")).toEqual({
      status: 500,
      error: "Billing error",
    });
  });

  test("searchWeb parses duckduckgo results and respects the limit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => `
        <div class="results">
          <div class="result">
            <a class="result__a" href="https://example.com/one">First result</a>
            <a class="result__snippet">Snippet one</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://example.com/two">Second result</a>
            <a class="result__snippet">Snippet two</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://example.com/three">Third result</a>
            <a class="result__snippet">Snippet three</a>
          </div>
        </div>
      `,
    } as Response);

    const results = await searchWeb("platforma ai", 2);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://duckduckgo.com/html/?q=platforma%20ai",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("Mozilla/5.0"),
        }),
      }),
    );
    expect(results).toEqual([
      {
        title: "First result",
        url: "https://example.com/one",
        snippet: "Snippet one",
      },
      {
        title: "Second result",
        url: "https://example.com/two",
        snippet: "Snippet two",
      },
    ]);
  });

  test("searchWeb throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    } as Response);

    await expect(searchWeb("platforma ai")).rejects.toThrow("Search failed: 503");
  });

  test("updateChatSummary skips disabled and short chats, then updates summary", async () => {
    await updateChatSummary({ chatId: "chat-0", userId: "user-0" });
    expect(mocks.prisma.chat.findFirst).not.toHaveBeenCalled();

    process.env.ENABLE_CHAT_SUMMARY = "1";
    mocks.prisma.chat.findFirst.mockResolvedValueOnce(null);
    await updateChatSummary({ chatId: "chat-1", userId: "user-1" });
    expect(mocks.prisma.chat.update).not.toHaveBeenCalled();

    mocks.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-1",
      messages: Array.from({ length: 11 }, (_, index) => ({
        role: index % 2 === 0 ? "USER" : "ASSISTANT",
        content: `message-${index}`,
        createdAt: new Date(`2026-04-14T00:00:${String(index).padStart(2, "0")}.000Z`),
      })),
    });
    await updateChatSummary({ chatId: "chat-1", userId: "user-1" });
    expect(mocks.prisma.chat.update).not.toHaveBeenCalled();

    mocks.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-1",
      messages: [
        ...Array.from({ length: 6 }, (_, index) => ({
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content: `message-${index}`,
          createdAt: new Date(`2026-04-14T00:00:${String(index).padStart(2, "0")}.000Z`),
        })),
        ...Array.from({ length: 6 }, (_, index) => ({
          role: index % 2 === 0 ? "USER" : "ASSISTANT",
          content: `tail-${index}`,
          createdAt: new Date(`2026-04-14T00:01:${String(index).padStart(2, "0")}.000Z`),
        })),
      ],
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Short summary" } }],
      }),
    } as Response);

    await updateChatSummary({
      chatId: "chat-1",
      userId: "user-1",
      apiKey: "summary-key",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer summary-key",
        }),
      }),
    );
    expect(mocks.prisma.chat.update).toHaveBeenCalledWith({
      where: { id: "chat-1" },
      data: { summary: "Short summary" },
    });
  });

  test("updateChatSummary ignores empty and failed summaries", async () => {
    process.env.ENABLE_CHAT_SUMMARY = "1";
    mocks.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-2",
      messages: Array.from({ length: 12 }, (_, index) => ({
        role: "SYSTEM",
        content: `system-${index}`,
        createdAt: new Date(`2026-04-14T00:00:${String(index).padStart(2, "0")}.000Z`),
      })),
    });

    await updateChatSummary({ chatId: "chat-2", userId: "user-2" });
    expect(mocks.prisma.chat.update).not.toHaveBeenCalled();

    mocks.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-3",
      messages: Array.from({ length: 12 }, (_, index) => ({
        role: "USER",
        content: `content-${index}`,
        createdAt: new Date(`2026-04-14T00:00:${String(index).padStart(2, "0")}.000Z`),
      })),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    } as Response);

    await updateChatSummary({ chatId: "chat-3", userId: "user-2" });
    expect(mocks.prisma.chat.update).not.toHaveBeenCalled();

    mocks.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-4",
      messages: Array.from({ length: 12 }, (_, index) => ({
        role: "USER",
        content: `content-${index}`,
        createdAt: new Date(`2026-04-14T00:00:${String(index).padStart(2, "0")}.000Z`),
      })),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "   " } }],
      }),
    } as Response);

    await updateChatSummary({ chatId: "chat-4", userId: "user-2" });
    expect(mocks.prisma.chat.update).not.toHaveBeenCalled();

    mocks.prisma.chat.findFirst.mockResolvedValueOnce({
      id: "chat-5",
      messages: Array.from({ length: 12 }, (_, index) => ({
        role: "USER",
        content: `content-${index}`,
        createdAt: new Date(`2026-04-14T00:00:${String(index).padStart(2, "0")}.000Z`),
      })),
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await updateChatSummary({ chatId: "chat-5", userId: "user-2" });
    expect(mocks.prisma.chat.update).not.toHaveBeenCalled();
  });

  test("logEvent writes when enabled and ignores failures", async () => {
    process.env.LOG_EVENTS = "1";
    await logEvent({
      type: "CHAT_CREATED" as any,
      message: "created",
      userId: "u-1",
      chatId: "c-1",
      modelId: "m-1",
      payload: { ok: true },
    });
    expect(mocks.prisma.eventLog.create).toHaveBeenCalledWith({
      data: {
        type: "CHAT_CREATED",
        message: "created",
        userId: "u-1",
        chatId: "c-1",
        modelId: "m-1",
        payload: { ok: true },
      },
    });

    mocks.prisma.eventLog.create.mockRejectedValueOnce(new Error("db down"));
    await expect(
      logEvent({
        type: "CHAT_CREATED" as any,
      }),
    ).resolves.toBeUndefined();
  });

  test("logEvent skips writes when disabled", async () => {
    process.env.LOG_EVENTS = "0";
    await logEvent({
      type: "CHAT_CREATED" as any,
    });
    expect(mocks.prisma.eventLog.create).not.toHaveBeenCalled();
  });

  test("user settings helpers normalize objects and strings", () => {
    expect(getSettingsObject(null)).toEqual({});
    expect(getSettingsObject(["bad"] as unknown as never)).toEqual({});
    expect(getSettingsObject({ existing: 1 })).toEqual({ existing: 1 });

    const settings = {
      openrouterApiKey: "  key-1  ",
      userProfile: " profile ",
      assistantInstructions: " instructions ",
      userGoal: " goal ",
      userTone: " tone ",
      onboarded: true,
    };

    expect(getUserOpenRouterKey(settings)).toBe("key-1");
    expect(getUserProfile(settings)).toBe("profile");
    expect(getUserAssistantInstructions(settings)).toBe("instructions");
    expect(getUserGoal(settings)).toBe("goal");
    expect(getUserTone(settings)).toBe("tone");
    expect(getUserOnboarded(settings)).toBe(true);
    expect(getUserOnboarded({ onboarded: "yes" } as any)).toBe(false);
    expect(getUserOpenRouterKey({ openrouterApiKey: "" } as any)).toBeUndefined();
    expect(getUserProfile({ userProfile: 42 } as any)).toBeUndefined();
    expect(getUserAssistantInstructions({ assistantInstructions: "   " } as any)).toBeUndefined();
    expect(getUserGoal({ userGoal: null } as any)).toBeUndefined();
    expect(getUserTone({ userTone: false } as any)).toBeUndefined();

    expect(mergeSettings({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(removeSettingsKey({ a: 1, b: 2 }, "a")).toEqual({ b: 2 });
  });
});
