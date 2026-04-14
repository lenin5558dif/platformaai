import assert from "node:assert/strict";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  startHandlers: [] as Array<(ctx: any) => Promise<void> | void>,
  actionHandlers: [] as Array<{ pattern: unknown; handler: (ctx: any) => Promise<void> | void }>,
  onHandlers: [] as Array<{ event: unknown; handler: (ctx: any) => Promise<void> | void }>,
  launch: vi.fn(),
  stop: vi.fn(),
  auth: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    chat: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    message: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
  },
  getOpenRouterBaseUrl: vi.fn(() => "https://openrouter.test"),
  getOpenRouterHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
  trimMessages: vi.fn((messages) => messages),
  calculateCreditsFromStt: vi.fn(() => ({ credits: 1 })),
  calculateCreditsFromUsage: vi.fn(),
  preflightCredits: vi.fn(),
  spendCredits: vi.fn(),
  transcribeAudio: vi.fn(),
  logEvent: vi.fn(),
  logAudit: vi.fn(),
  checkModelAllowed: vi.fn(),
  authorizeAiRequest: vi.fn(),
  resolveOrgCostCenterId: vi.fn(),
  getTelegramAccessBlockMessage: vi.fn(),
  beginTelegramLink: vi.fn(),
  cancelTelegramLink: vi.fn(),
  confirmTelegramLink: vi.fn(),
  getFileLink: vi.fn(() => new URL("https://files.test/audio.ogg")),
  randomBytes: vi.fn(() => Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex")),
}));

let botLoaded = false;

vi.mock("dotenv/config", () => ({}));

vi.mock("telegraf", () => {
  class Telegraf {
    token: string;
    constructor(token: string) {
      this.token = token;
    }
    start(handler: (ctx: any) => Promise<void> | void) {
      state.startHandlers.push(handler);
    }
    action(pattern: unknown, handler: (ctx: any) => Promise<void> | void) {
      state.actionHandlers.push({ pattern, handler });
    }
    on(event: unknown, handler: (ctx: any) => Promise<void> | void) {
      state.onHandlers.push({ event, handler });
    }
    launch = state.launch;
    stop = state.stop;
  }

  return {
    Telegraf,
    Markup: {
      inlineKeyboard: (buttons: unknown) => ({
        inline_keyboard: Array.isArray(buttons) && Array.isArray(buttons[0]) ? buttons : [buttons],
      }),
      button: {
        callback: (text: string, data: string) => ({ text, callback_data: data, hide: false }),
      },
    },
  };
});

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    user = state.prisma.user;
    chat = state.prisma.chat;
    message = state.prisma.message;
    organization = state.prisma.organization;
    orgMembership = state.prisma.orgMembership;
  },
  Prisma: {},
}));

vi.mock("@/lib/openrouter", () => ({
  getOpenRouterBaseUrl: state.getOpenRouterBaseUrl,
  getOpenRouterHeaders: state.getOpenRouterHeaders,
}));

vi.mock("@/lib/context", () => ({
  trimMessages: state.trimMessages,
}));

vi.mock("@/lib/pricing", () => ({
  calculateCreditsFromStt: state.calculateCreditsFromStt,
  calculateCreditsFromUsage: state.calculateCreditsFromUsage,
}));

vi.mock("@/lib/billing", () => ({
  preflightCredits: state.preflightCredits,
  spendCredits: state.spendCredits,
}));

vi.mock("@/lib/whisper", () => ({
  transcribeAudio: state.transcribeAudio,
}));

vi.mock("@/lib/telemetry", () => ({
  logEvent: state.logEvent,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: state.logAudit,
}));

vi.mock("@/lib/ai-authorization", () => ({
  checkModelAllowed: state.checkModelAllowed,
  authorizeAiRequest: state.authorizeAiRequest,
}));

vi.mock("@/lib/cost-centers", () => ({
  resolveOrgCostCenterId: state.resolveOrgCostCenterId,
}));

vi.mock("@/lib/telegram-linking", () => ({
  getTelegramAccessBlockMessage: state.getTelegramAccessBlockMessage,
}));

vi.mock("@/bot/telegram-linking-flow", () => ({
  beginTelegramLink: state.beginTelegramLink,
  cancelTelegramLink: state.cancelTelegramLink,
  confirmTelegramLink: state.confirmTelegramLink,
}));

vi.mock("node:crypto", () => ({
  randomBytes: state.randomBytes,
}));

async function loadBot() {
  process.env.TELEGRAM_BOT_TOKEN = "bot-token";
  if (!botLoaded) {
    await import("@/bot/index");
    botLoaded = true;
  }
  return {
    start: state.startHandlers[0],
    actions: state.actionHandlers,
    ons: state.onHandlers,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const reply = vi.fn().mockResolvedValue({ message_id: 77 });
  const answerCbQuery = vi.fn().mockResolvedValue(undefined);
  const sendChatAction = vi.fn().mockResolvedValue(undefined);
  const editMessageText = vi.fn().mockResolvedValue(undefined);
  const deleteMessage = vi.fn().mockResolvedValue(undefined);
  const getFileLink = vi.fn().mockResolvedValue(new URL("https://files.test/audio.ogg"));

  return {
    from: { id: 111 },
    chat: { id: 222 },
    message: { text: "hello" },
    match: [],
    reply,
    answerCbQuery,
    sendChatAction,
    telegram: {
      editMessageText,
      deleteMessage,
      getFileLink,
    },
    ...overrides,
  };
}

function jsonStreamChunk(content: string, usage?: Record<string, unknown>) {
  const payload = JSON.stringify({
    choices: [{ delta: { content } }],
    ...(usage ? { usage } : {}),
  });
  return `data: ${payload}\n`;
}

describe("bot and messaging flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      telegramId: "111",
      settings: null,
      orgId: null,
      costCenterId: null,
      isActive: true,
      globalRevokeCounter: 0,
    });
    state.prisma.user.update.mockResolvedValue({});
    state.prisma.chat.findFirst.mockResolvedValue(null);
    state.prisma.chat.create.mockResolvedValue({
      id: "chat-1",
      userId: "user-1",
      modelId: "openai/gpt-4o",
      source: "TELEGRAM",
    });
    state.prisma.chat.update.mockResolvedValue({});
    state.prisma.message.create.mockResolvedValue({});
    state.prisma.message.findMany.mockResolvedValue([
      { role: "USER", content: "hello" },
      { role: "ASSISTANT", content: "world" },
    ]);
    state.prisma.organization.findUnique.mockResolvedValue({ settings: null });
    state.prisma.orgMembership.findUnique.mockResolvedValue({
      id: "membership-1",
      defaultCostCenterId: "cc-1",
    });
    state.getTelegramAccessBlockMessage.mockReturnValue(null);
    state.beginTelegramLink.mockResolvedValue({
      ok: true,
      prompt: {
        text: "Confirm link",
        confirmData: "confirm",
        cancelData: "cancel",
      },
    });
    state.cancelTelegramLink.mockResolvedValue(undefined);
    state.confirmTelegramLink.mockResolvedValue({ ok: true });
    state.authorizeAiRequest.mockResolvedValue({
      allowed: true,
      finalContent: "sanitized prompt",
    });
    state.checkModelAllowed.mockResolvedValue({ allowed: true });
    state.preflightCredits.mockResolvedValue(undefined);
    state.resolveOrgCostCenterId.mockResolvedValue("cc-1");
    state.spendCredits.mockResolvedValue(undefined);
    state.calculateCreditsFromUsage.mockResolvedValue({ credits: 2 });
    state.transcribeAudio.mockResolvedValue("voice prompt");
    state.logEvent.mockResolvedValue(undefined);
    state.logAudit.mockResolvedValue(undefined);
  });

  test("registers handlers and handles /start with and without a token", async () => {
    const { start } = await loadBot();
    expect(start).toBeTypeOf("function");
    expect(state.launch).toHaveBeenCalledTimes(1);

    const noTokenCtx = makeCtx({ message: { text: "/start" } });
    await start(noTokenCtx);
    expect(noTokenCtx.reply).toHaveBeenCalledWith(
      "Добро пожаловать в PlatformaAI. Используйте /start <token> для авторизации."
    );

    state.beginTelegramLink.mockResolvedValueOnce({
      ok: false,
      message: "invalid token",
    });
    const badTokenCtx = makeCtx({ message: { text: "/start token-1" } });
    await start(badTokenCtx);
    expect(badTokenCtx.reply).toHaveBeenCalledWith("invalid token");

    state.beginTelegramLink.mockResolvedValueOnce({
      ok: true,
      prompt: {
        text: "Confirm link",
        confirmData: "confirm",
        cancelData: "cancel",
      },
    });
    const okTokenCtx = makeCtx({ message: { text: "/start token-2" } });
    await start(okTokenCtx);
    expect(okTokenCtx.reply).toHaveBeenCalledWith(
      "Confirm link",
      expect.objectContaining({
        inline_keyboard: [
          [
            expect.objectContaining({ text: "Подтвердить", callback_data: "confirm" }),
            expect.objectContaining({ text: "Отменить", callback_data: "cancel" }),
          ],
        ],
      })
    );
  });

  test("rejects unauthorized text messages and blocked accounts", async () => {
    const { ons } = await loadBot();
    const textHandler = ons.find((entry) => entry.event === "text")?.handler;
    expect(textHandler).toBeTypeOf("function");

    const slashCtx = makeCtx({ message: { text: "/help" } });
    await textHandler!(slashCtx);
    expect(slashCtx.reply).not.toHaveBeenCalled();

    state.prisma.user.findUnique.mockResolvedValueOnce(null);
    const unauthorizedCtx = makeCtx({ message: { text: "hello" } });
    await textHandler!(unauthorizedCtx);
    expect(unauthorizedCtx.reply).toHaveBeenCalledWith(
      "Сначала авторизуйтесь через /start <token>."
    );

    state.prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      telegramId: "111",
      settings: null,
      orgId: null,
      costCenterId: null,
      isActive: false,
      globalRevokeCounter: 2,
    });
    state.getTelegramAccessBlockMessage.mockReturnValueOnce("blocked");
    const blockedCtx = makeCtx({ message: { text: "hello" } });
    await textHandler!(blockedCtx);
    expect(blockedCtx.reply).toHaveBeenCalledWith("blocked");
  });

  test("processes a text prompt end to end", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          const chunks = [
            new TextEncoder().encode(
              jsonStreamChunk("Hel", { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })
            ),
            new TextEncoder().encode("data: [DONE]\n"),
          ];
          let index = 0;
          return {
            read: async () => {
              if (index >= chunks.length) {
                return { done: true, value: undefined };
              }
              return { done: false, value: chunks[index++] };
            },
          };
        },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ons } = await loadBot();
    const textHandler = ons.find((entry) => entry.event === "text")?.handler;
    expect(textHandler).toBeTypeOf("function");

    const ctx = makeCtx({ message: { text: "hello world" } });
    await textHandler!(ctx);

    expect(state.authorizeAiRequest).toHaveBeenCalledWith(
      "openai/gpt-4o",
      "hello world",
      expect.objectContaining({
        userId: "user-1",
        orgId: null,
        source: "telegram",
      })
    );
    expect(state.prisma.chat.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        title: "Telegram чат",
        modelId: "openai/gpt-4o",
        source: "TELEGRAM",
      },
    });
    expect(state.prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatId: "chat-1",
          role: "ASSISTANT",
          content: "Hel",
          cost: 2,
          modelId: "openai/gpt-4o",
        }),
      })
    );
    expect(ctx.telegram.editMessageText).toHaveBeenCalled();
    expect(state.spendCredits).toHaveBeenCalledWith({
      userId: "user-1",
      amount: 2,
      description: "OpenRouter openai/gpt-4o",
      costCenterId: undefined,
    });
  });

  test("handles the model action when policy allows or blocks it", async () => {
    const { actions } = await loadBot();
    const modelAction = actions.find((entry) => String(entry.pattern).includes("model"));
    expect(modelAction?.handler).toBeTypeOf("function");

    const blockedCtx = makeCtx({ match: ["", "blocked-model"] });
    state.checkModelAllowed.mockResolvedValueOnce({ allowed: false });
    await modelAction!.handler(blockedCtx);
    expect(blockedCtx.answerCbQuery).toHaveBeenCalledWith(
      "Эта модель запрещена политикой организации.",
      { show_alert: true }
    );

    const allowedCtx = makeCtx({ match: ["", "openai/gpt-4o-mini"] });
    state.checkModelAllowed.mockResolvedValueOnce({ allowed: true });
    await modelAction!.handler(allowedCtx);
    expect(state.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { settings: { telegramModel: "openai/gpt-4o-mini" } },
    });
    expect(allowedCtx.answerCbQuery).toHaveBeenCalledWith("Модель openai/gpt-4o-mini выбрана");
  });

  test("handles telegram link confirmation and cancellation", async () => {
    const { actions } = await loadBot();
    const confirmAction = actions.find((entry) =>
      String(entry.pattern).includes("tg_link_confirm")
    );
    const cancelAction = actions.find((entry) =>
      String(entry.pattern).includes("tg_link_cancel")
    );
    expect(confirmAction?.handler).toBeTypeOf("function");
    expect(cancelAction?.handler).toBeTypeOf("function");

    const confirmCtx = makeCtx({ match: ["", "token-1"] });
    await confirmAction!.handler(confirmCtx);
    expect(state.confirmTelegramLink).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: "token-1",
        telegramId: "111",
      })
    );

    const cancelCtx = makeCtx({ match: ["", "token-2"] });
    await cancelAction!.handler(cancelCtx);
    expect(state.cancelTelegramLink).toHaveBeenCalledWith({
      prisma: expect.any(Object),
      tokenId: "token-2",
    });
    expect(cancelCtx.reply).toHaveBeenCalledWith("Привязка отменена.");
  });

  test("covers voice transcription fallback and error branches", async () => {
    const { ons } = await loadBot();
    const voiceHandler = ons.find((entry) => entry.event === "voice")?.handler;
    expect(voiceHandler).toBeTypeOf("function");

    state.transcribeAudio.mockResolvedValueOnce("");
    const emptyVoiceCtx = makeCtx({
      message: { voice: { file_id: "voice-1", duration: 12 } },
      telegram: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        getFileLink: vi.fn().mockResolvedValue(new URL("https://files.test/voice.ogg")),
      },
    });
    await voiceHandler!(emptyVoiceCtx);
    expect(emptyVoiceCtx.telegram.editMessageText).toHaveBeenCalledWith(
      222,
      77,
      undefined,
      "Не удалось распознать речь."
    );

    state.transcribeAudio.mockRejectedValueOnce(new Error("stt failed"));
    const failingVoiceCtx = makeCtx({
      message: { voice: { file_id: "voice-2", duration: 15 } },
      telegram: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        getFileLink: vi.fn().mockResolvedValue(new URL("https://files.test/voice.ogg")),
      },
    });
    await voiceHandler!(failingVoiceCtx);
    expect(failingVoiceCtx.telegram.editMessageText).toHaveBeenCalledWith(
      222,
      77,
      undefined,
      "Ошибка распознавания голоса."
    );
    expect(state.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "STT_ERROR",
        userId: "user-1",
      })
    );
  });

  test("streams a long reply with org cost center resolution and editing fallback", async () => {
    state.prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      telegramId: "111",
      settings: { telegramModel: "openai/gpt-4o" },
      orgId: "org-1",
      costCenterId: "cc-user",
      isActive: true,
      globalRevokeCounter: 0,
    });
    state.prisma.organization.findUnique.mockResolvedValue({ settings: { dlp: "on" } });
    state.resolveOrgCostCenterId.mockResolvedValue("cc-resolved");
    state.calculateCreditsFromUsage.mockResolvedValue({ credits: 1 });
    state.preflightCredits.mockResolvedValue(undefined);
    state.spendCredits.mockResolvedValue(undefined);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          const chunks = [
            new TextEncoder().encode(
              jsonStreamChunk("A".repeat(4200), {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3,
              })
            ),
            new TextEncoder().encode("data: [DONE]\n"),
          ];
          let index = 0;
          return {
            read: async () => {
              if (index >= chunks.length) {
                return { done: true, value: undefined };
              }
              return { done: false, value: chunks[index++] };
            },
          };
        },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ons } = await loadBot();
    const textHandler = ons.find((entry) => entry.event === "text")?.handler;
    expect(textHandler).toBeTypeOf("function");

    const ctx = makeCtx({
      message: { text: "hello world" },
      telegram: {
        editMessageText: vi.fn().mockRejectedValue(new Error("edit failed")),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        getFileLink: vi.fn().mockResolvedValue(new URL("https://files.test/audio.ogg")),
      },
    });
    await textHandler!(ctx);

    expect(state.resolveOrgCostCenterId).toHaveBeenCalledWith({
      orgId: "org-1",
      membershipId: "membership-1",
      defaultCostCenterId: "cc-1",
      fallbackCostCenterId: "cc-user",
    });
    expect(state.spendCredits).toHaveBeenCalledWith({
      userId: "user-1",
      amount: 1,
      description: "OpenRouter openai/gpt-4o",
      costCenterId: "cc-resolved",
    });
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledWith(222, 77);
    expect(ctx.reply.mock.calls.length).toBeGreaterThan(1);
  });

  test("processes voice messages and bills STT credits", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          const chunks = [
            new TextEncoder().encode(
              jsonStreamChunk("Voice reply", {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3,
              })
            ),
            new TextEncoder().encode("data: [DONE]\n"),
          ];
          let index = 0;
          return {
            read: async () => {
              if (index >= chunks.length) {
                return { done: true, value: undefined };
              }
              return { done: false, value: chunks[index++] };
            },
          };
        },
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    state.transcribeAudio.mockResolvedValueOnce("voice prompt");
    state.calculateCreditsFromStt.mockReturnValueOnce({ credits: 2 });
    state.calculateCreditsFromUsage.mockResolvedValueOnce({ credits: 1 });
    state.spendCredits.mockResolvedValue(undefined);

    const { ons } = await loadBot();
    const voiceHandler = ons.find((entry) => entry.event === "voice")?.handler;
    expect(voiceHandler).toBeTypeOf("function");

    const ctx = makeCtx({
      message: { voice: { file_id: "voice-2", duration: 22 } },
    });

    await voiceHandler!(ctx);

    expect(state.transcribeAudio).toHaveBeenCalledWith({
      fileUrl: "https://files.test/audio.ogg",
      fileName: "voice-2.ogg",
      mimeType: "audio/ogg",
    });
    expect(state.spendCredits).toHaveBeenCalledWith({
      userId: "user-1",
      amount: 2,
      description: "Whisper STT (22s)",
      costCenterId: undefined,
    });
    expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(
      222,
      77,
      undefined,
      "Распознано. Генерирую ответ..."
    );
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledWith(222, 77);
  });

  test("replies directly when voice billing fails without a chat", async () => {
    state.transcribeAudio.mockResolvedValueOnce("voice prompt");
    state.calculateCreditsFromStt.mockReturnValueOnce({ credits: 2 });
    state.spendCredits.mockRejectedValueOnce(new Error("INSUFFICIENT_BALANCE"));

    const { ons } = await loadBot();
    const voiceHandler = ons.find((entry) => entry.event === "voice")?.handler;
    expect(voiceHandler).toBeTypeOf("function");

    const ctx = makeCtx({
      chat: undefined,
      message: { voice: { file_id: "voice-3", duration: 30 } },
      telegram: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        getFileLink: vi.fn().mockResolvedValue(new URL("https://files.test/audio.ogg")),
      },
    });

    await voiceHandler!(ctx);

    expect(state.logEvent).toHaveBeenCalledWith({
      type: "BILLING_ERROR",
      userId: "user-1",
      message: "INSUFFICIENT_BALANCE",
      payload: { source: "stt", duration: 30 },
    });
    expect(ctx.reply).toHaveBeenCalledWith("Недостаточно баланса.");
  });

  test("replies directly when voice transcription fails without a chat", async () => {
    state.transcribeAudio.mockRejectedValueOnce(new Error("stt failed"));

    const { ons } = await loadBot();
    const voiceHandler = ons.find((entry) => entry.event === "voice")?.handler;
    expect(voiceHandler).toBeTypeOf("function");

    const ctx = makeCtx({
      chat: undefined,
      message: { voice: { file_id: "voice-4", duration: 14 } },
      telegram: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        getFileLink: vi.fn().mockResolvedValue(new URL("https://files.test/audio.ogg")),
      },
    });

    await voiceHandler!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("Ошибка распознавания голоса.");
  });
});
