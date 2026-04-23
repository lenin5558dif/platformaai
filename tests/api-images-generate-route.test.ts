import { beforeEach, describe, expect, test, vi } from "vitest";
import { HttpError } from "../src/lib/http-error";

const state = vi.hoisted(() => ({
  authenticated: true,
  generateImageForUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? { user: { id: "user_1" } } : null)),
}));

vi.mock("@/lib/image-generation", () => ({
  generateImageForUser: state.generateImageForUser,
}));

describe("api images generate route", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.generateImageForUser.mockReset();
  });

  test("returns 401 when session is missing", async () => {
    state.authenticated = false;
    const { POST } = await import("../src/app/api/images/generate/route");

    const res = await POST(new Request("http://localhost/api/images/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Нарисуй кота" }),
    }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized",
      code: "AUTH_UNAUTHORIZED",
    });
  });

  test("validates request body", async () => {
    const { POST } = await import("../src/app/api/images/generate/route");

    const res = await POST(new Request("http://localhost/api/images/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "  " }),
    }));

    expect(res.status).toBe(400);
    expect(state.generateImageForUser).not.toHaveBeenCalled();
  });

  test("calls image generation service", async () => {
    state.generateImageForUser.mockResolvedValue({
      data: {
        id: "gen_1",
        prompt: "Нарисуй город",
        modelId: "image/free",
        status: "COMPLETED",
        cost: "0",
      },
    });
    const { POST } = await import("../src/app/api/images/generate/route");

    const res = await POST(new Request("http://localhost/api/images/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: "  Нарисуй город  ",
        modelId: "image/free",
        chatId: "chat_1",
        aspectRatio: "16:9",
        imageSize: "1K",
      }),
    }));

    expect(res.status).toBe(201);
    expect(state.generateImageForUser).toHaveBeenCalledWith({
      userId: "user_1",
      prompt: "Нарисуй город",
      modelId: "image/free",
      chatId: "chat_1",
      aspectRatio: "16:9",
      imageSize: "1K",
      costCenterId: null,
    });
    expect(await res.json()).toMatchObject({ data: { id: "gen_1" } });
  });

  test("maps service http errors", async () => {
    state.generateImageForUser.mockRejectedValue(
      new HttpError(402, "PAID_IMAGE_MODEL_REQUIRED", "Эта модель доступна только на платном тарифе.")
    );
    const { POST } = await import("../src/app/api/images/generate/route");

    const res = await POST(new Request("http://localhost/api/images/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Нарисуй город" }),
    }));

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "Эта модель доступна только на платном тарифе.",
      code: "PAID_IMAGE_MODEL_REQUIRED",
    });
  });
});
