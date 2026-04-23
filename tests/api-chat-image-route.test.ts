import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  chat: { id: "chat_1", modelId: "text/model" } as null | Record<string, unknown>,
  messageCreate: vi.fn(),
  imageGenerationUpdate: vi.fn(),
  chatUpdate: vi.fn(),
  generateImageForUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? { user: { id: "user_1" } } : null)),
}));

vi.mock("@/lib/chat-ownership", () => ({
  findOwnedChat: vi.fn(async () => state.chat),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    message: {
      create: state.messageCreate,
    },
    imageGeneration: {
      update: state.imageGenerationUpdate,
    },
    chat: {
      update: state.chatUpdate,
    },
  },
}));

vi.mock("@/lib/image-generation", () => ({
  generateImageForUser: state.generateImageForUser,
}));

describe("api chat image route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.chat = { id: "chat_1", modelId: "text/model" };
    state.messageCreate.mockReset()
      .mockResolvedValueOnce({ id: "msg_user", role: "USER" })
      .mockResolvedValueOnce({ id: "msg_assistant", role: "ASSISTANT" });
    state.imageGenerationUpdate.mockReset().mockResolvedValue({});
    state.chatUpdate.mockReset().mockResolvedValue({});
    state.generateImageForUser.mockReset().mockResolvedValue({
      data: {
        id: "gen_1",
        prompt: "Нарисуй город",
        modelId: "image/free",
        fileUrl: "/api/images/gen_1/file",
        cost: "0",
      },
    });
  });

  test("returns 401 without session", async () => {
    state.authenticated = false;
    const { POST } = await import("../src/app/api/ai/chat-image/route");

    const res = await POST(new Request("http://localhost/api/ai/chat-image", {
      method: "POST",
      body: JSON.stringify({ chatId: "chat_1", prompt: "Нарисуй город" }),
    }));

    expect(res.status).toBe(401);
  });

  test("creates user and assistant image messages", async () => {
    const { POST } = await import("../src/app/api/ai/chat-image/route");

    const res = await POST(new Request("http://localhost/api/ai/chat-image", {
      method: "POST",
      body: JSON.stringify({
        chatId: "chat_1",
        prompt: " Нарисуй город ",
        modelId: "image/free",
      }),
    }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(state.messageCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        chatId: "chat_1",
        userId: "user_1",
        role: "USER",
        content: "Нарисуй город",
      }),
    });
    expect(state.generateImageForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        chatId: "chat_1",
        prompt: "Нарисуй город",
        modelId: "image/free",
      })
    );
    expect(state.messageCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        role: "ASSISTANT",
        modelId: "image/free",
      }),
    });
    expect(state.imageGenerationUpdate).toHaveBeenCalledWith({
      where: { id: "gen_1" },
      data: { messageId: "msg_assistant" },
    });
    expect(json.data).toMatchObject({
      userMessage: { id: "msg_user" },
      assistantMessage: { id: "msg_assistant" },
      generation: { id: "gen_1" },
    });
  });

  test("returns 404 for chat outside ownership", async () => {
    state.chat = null;
    const { POST } = await import("../src/app/api/ai/chat-image/route");

    const res = await POST(new Request("http://localhost/api/ai/chat-image", {
      method: "POST",
      body: JSON.stringify({ chatId: "missing", prompt: "Нарисуй город" }),
    }));

    expect(res.status).toBe(404);
    expect(state.messageCreate).not.toHaveBeenCalled();
  });
});
