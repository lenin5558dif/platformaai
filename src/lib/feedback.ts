import { FeedbackCategory, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { getSettingsObject } from "@/lib/user-settings";

const TELEGRAM_TIMEOUT_MS = 10_000;

type FeedbackUserClient = Pick<PrismaClient["user"], "findUnique" | "findMany">;
type FeedbackClient = Pick<PrismaClient, "feedback"> & {
  user: FeedbackUserClient;
};

export const feedbackFormSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  category: z.nativeEnum(FeedbackCategory),
  message: z
    .string()
    .trim()
    .min(10, "Опишите ситуацию чуть подробнее")
    .max(2000, "Сообщение слишком длинное"),
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function parseFeedbackTelegramChatIds(raw?: string | null) {
  if (!raw) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .split(/[,\n\s]+/)
        .map((item) => item.trim())
        .filter((item) => /^-?\d+$/.test(item))
    )
  );
}

function formatFeedbackTelegramMessage(input: {
  rating: number;
  category: FeedbackCategory;
  message: string;
  email?: string | null;
  telegramId?: string | null;
  displayName?: string | null;
}) {
  const categoryLabel =
    input.category === "BUG"
      ? "Баг"
      : input.category === "IMPROVEMENT"
        ? "Улучшение"
        : "Обратная связь";

  const stars = "★".repeat(input.rating) + "☆".repeat(5 - input.rating);
  const lines = [
    "<b>Новый отзыв в PlatformaAI</b>",
    "",
    `<b>Оценка:</b> ${escapeHtml(stars)} (${input.rating}/5)`,
    `<b>Тип:</b> ${escapeHtml(categoryLabel)}`,
  ];

  if (input.displayName) {
    lines.push(`<b>Пользователь:</b> ${escapeHtml(input.displayName)}`);
  }
  if (input.email) {
    lines.push(`<b>Email:</b> ${escapeHtml(input.email)}`);
  }
  if (input.telegramId) {
    lines.push(`<b>Telegram ID:</b> ${escapeHtml(input.telegramId)}`);
  }

  lines.push("", `<b>Сообщение:</b>\n${escapeHtml(input.message)}`);

  return lines.join("\n");
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return false;
  }

  const response = await fetchWithTimeout(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      timeoutMs: TELEGRAM_TIMEOUT_MS,
      timeoutLabel: "Telegram feedback notification",
    }
  );

  return response.ok;
}

export async function notifyFeedbackViaTelegram(args: {
  explicitChatIds?: string[];
  adminTelegramIds?: Array<string | null | undefined>;
  rating: number;
  category: FeedbackCategory;
  message: string;
  email?: string | null;
  telegramId?: string | null;
  displayName?: string | null;
}) {
  const recipients = Array.from(
    new Set(
      [
        ...(args.explicitChatIds ?? []),
        ...(args.adminTelegramIds ?? []),
      ].filter((value): value is string => Boolean(value?.trim()))
    )
  );

  if (recipients.length === 0) {
    return { delivered: 0, attempted: 0 };
  }

  const text = formatFeedbackTelegramMessage(args);
  let delivered = 0;

  for (const recipient of recipients) {
    try {
      if (await sendTelegramMessage(recipient, text)) {
        delivered += 1;
      }
    } catch {
      continue;
    }
  }

  return { delivered, attempted: recipients.length };
}

export async function createUserFeedback(args: {
  prisma: FeedbackClient;
  userId: string;
  rating: number;
  category: FeedbackCategory;
  message: string;
}) {
  const user = await args.prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      email: true,
      telegramId: true,
      settings: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const settings = getSettingsObject(user.settings ?? null);
  const displayName = [
    typeof settings.profileFirstName === "string" ? settings.profileFirstName : "",
    typeof settings.profileLastName === "string" ? settings.profileLastName : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const feedback = await args.prisma.feedback.create({
    data: {
      userId: user.id,
      rating: args.rating,
      category: args.category,
      message: args.message,
      emailSnapshot: user.email,
      telegramIdSnapshot: user.telegramId,
      displayNameSnapshot: displayName || null,
    },
  });

  const adminUsers = await args.prisma.user.findMany({
    where: {
      role: "ADMIN",
      telegramId: { not: null },
      isActive: true,
    },
    select: {
      telegramId: true,
    },
  });

  const explicitChatIds = parseFeedbackTelegramChatIds(
    process.env.FEEDBACK_TELEGRAM_CHAT_IDS
  );

  const notification = await notifyFeedbackViaTelegram({
    explicitChatIds,
    adminTelegramIds: explicitChatIds.length === 0 ? adminUsers.map((item) => item.telegramId) : [],
    rating: feedback.rating,
    category: feedback.category,
    message: feedback.message,
    email: feedback.emailSnapshot,
    telegramId: feedback.telegramIdSnapshot,
    displayName: feedback.displayNameSnapshot,
  });

  return {
    feedback,
    notification,
  };
}
