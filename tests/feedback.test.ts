import { beforeEach, describe, expect, test, vi } from "vitest";
import { FeedbackCategory } from "@prisma/client";
import {
  createUserFeedback,
  notifyFeedbackViaTelegram,
  parseFeedbackTelegramChatIds,
} from "@/lib/feedback";

const state = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
}));

vi.mock("@/lib/fetch-timeout", () => ({
  fetchWithTimeout: state.fetchWithTimeoutMock,
}));

describe("feedback helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FEEDBACK_TELEGRAM_CHAT_IDS;
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
  });

  test("parses telegram recipient ids from env-style string", () => {
    expect(
      parseFeedbackTelegramChatIds("12345, 67890\n-100123  bad-value 12345")
    ).toEqual(["12345", "67890", "-100123"]);
  });

  test("sends notifications to explicit telegram recipients", async () => {
    state.fetchWithTimeoutMock.mockResolvedValue({ ok: true });

    const result = await notifyFeedbackViaTelegram({
      explicitChatIds: ["12345", "67890"],
      rating: 5,
      category: FeedbackCategory.BUG,
      message: "Кнопка оплаты зависает после подтверждения.",
      email: "user@example.com",
      telegramId: "111111",
      displayName: "Nico User",
    });

    expect(result).toEqual({ delivered: 2, attempted: 2 });
    expect(state.fetchWithTimeoutMock).toHaveBeenCalledTimes(2);
    expect(state.fetchWithTimeoutMock.mock.calls[0]?.[0]).toBe(
      "https://api.telegram.org/bottelegram-token/sendMessage"
    );
    expect(String(state.fetchWithTimeoutMock.mock.calls[0]?.[1]?.body)).toContain(
      "Кнопка оплаты зависает"
    );
  });

  test("creates feedback and falls back to admin telegram ids when env is empty", async () => {
    state.fetchWithTimeoutMock.mockResolvedValue({ ok: true });

    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({
          id: "user_1",
          email: "user@example.com",
          telegramId: "555111",
          settings: {
            profileFirstName: "Nico",
            profileLastName: "Fix",
          },
        })),
        findMany: vi.fn(async () => [
          { telegramId: "999001" },
          { telegramId: "999002" },
        ]),
      },
      feedback: {
        create: vi.fn(async ({ data }: any) => ({
          id: "feedback_1",
          ...data,
        })),
      },
    } as any;

    const result = await createUserFeedback({
      prisma,
      userId: "user_1",
      rating: 4,
      category: FeedbackCategory.IMPROVEMENT,
      message: "Добавьте быстрый переход в поддержку прямо из настроек.",
    });

    expect(prisma.feedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user_1",
        rating: 4,
        category: FeedbackCategory.IMPROVEMENT,
        displayNameSnapshot: "Nico Fix",
      }),
    });
    expect(result.notification).toEqual({ delivered: 2, attempted: 2 });
    expect(state.fetchWithTimeoutMock).toHaveBeenCalledTimes(2);
  });
});
