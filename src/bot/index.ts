import "dotenv/config";
import { Telegraf, Markup, type Context } from "telegraf";
import { PrismaClient, Prisma, type User } from "@prisma/client";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";
import { trimMessages, type ChatMessage } from "@/lib/context";
import {
  calculateCreditsFromStt,
  calculateCreditsFromUsage,
} from "@/lib/pricing";
import { spendCredits } from "@/lib/billing";
import { transcribeAudio } from "@/lib/whisper";
import { logEvent } from "@/lib/telemetry";
import { getOrgDlpPolicy, getOrgModelPolicy } from "@/lib/org-settings";
import { evaluateDlp } from "@/lib/dlp";
import { isModelAllowed } from "@/lib/model-policy";
import { logAudit } from "@/lib/audit";

const prisma = new PrismaClient();
const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set");
}

const DEFAULT_MODEL = "openai/gpt-4o";

const bot = new Telegraf(botToken);

const TELEGRAM_MESSAGE_LIMIT = 4000;

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeCodeBlock(content: string) {
  const trimmed = content.replace(/^\n+|\n+$/g, "");
  const lines = trimmed.split("\n");
  if (lines.length > 1 && /^[a-zA-Z0-9_-]+$/.test(lines[0].trim())) {
    lines.shift();
  }
  return lines.join("\n");
}

function formatInlineCode(text: string) {
  const parts = text.split("`");
  if (parts.length % 2 === 0) {
    return escapeHtml(text);
  }

  return parts
    .map((part, index) =>
      index % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part)
    )
    .join("");
}

function renderTelegramHtml(text: string) {
  const fenceRegex = /```([\s\S]*?)```/g;
  const chunks: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      const segment = text.slice(lastIndex, start);
      chunks.push(formatInlineCode(segment));
    }

    const code = normalizeCodeBlock(match[1] ?? "");
    chunks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    chunks.push(formatInlineCode(text.slice(lastIndex)));
  }

  return chunks.join("");
}

function getSettings(user: { settings: Prisma.JsonValue }) {
  return (user.settings && typeof user.settings === "object"
    ? user.settings
    : {}) as Record<string, unknown>;
}

async function updateSettings(userId: string, patch: Record<string, unknown>) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  });

  if (!user) return;
  const settings = getSettings(user);
  const nextSettings = { ...settings, ...patch } as Prisma.InputJsonValue;
  await prisma.user.update({
    where: { id: userId },
    data: { settings: nextSettings },
  });
}

async function resolveModel(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  });

  if (!user) return DEFAULT_MODEL;
  const settings = getSettings(user);
  const model = settings.telegramModel;
  return typeof model === "string" ? model : DEFAULT_MODEL;
}

async function getOrCreateChat(userId: string, modelId: string) {
  const chat = await prisma.chat.findFirst({
    where: { userId, modelId, source: "TELEGRAM" },
    orderBy: { updatedAt: "desc" },
  });

  if (chat) return chat;

  return prisma.chat.create({
    data: {
      userId,
      title: "Telegram чат",
      modelId,
      source: "TELEGRAM",
    },
  });
}

async function fetchChatMessages(chatId: string) {
  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  return messages.map((message) => ({
    role:
      message.role === "USER"
        ? "user"
        : message.role === "ASSISTANT"
        ? "assistant"
        : "system",
    content: message.content,
  })) as ChatMessage[];
}

function splitMessage(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT) {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= limit) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= limit) {
      current = line;
      continue;
    }

    for (let i = 0; i < line.length; i += limit) {
      chunks.push(line.slice(i, i + limit));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function replyWithFallback(ctx: Context, text: string, html: boolean) {
  try {
    if (html) {
      await ctx.reply(text, { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(text);
  } catch {
    await ctx.reply(text);
  }
}

async function sendReply(
  ctx: Context,
  text: string,
  placeholderMessageId?: number
) {
  const raw = text || "Ответ пустой.";
  const html = renderTelegramHtml(raw);
  const chatId = ctx.chat?.id;
  let deletePlaceholder = false;

  if (
    placeholderMessageId &&
    chatId &&
    html.length <= TELEGRAM_MESSAGE_LIMIT
  ) {
    try {
      await ctx.telegram.editMessageText(
        chatId,
        placeholderMessageId,
        undefined,
        html,
        { parse_mode: "HTML" }
      );
      return;
    } catch {
      try {
        await ctx.telegram.editMessageText(
          chatId,
          placeholderMessageId,
          undefined,
          raw
        );
        return;
      } catch {
        deletePlaceholder = true;
      }
    }
  }

  if (html.length <= TELEGRAM_MESSAGE_LIMIT) {
    await replyWithFallback(ctx, html, true);
    if (deletePlaceholder && chatId && typeof placeholderMessageId === "number") {
      void ctx.telegram.deleteMessage(chatId, placeholderMessageId).catch(() => {});
    }
    return;
  }

  const shouldDeletePlaceholder =
    typeof placeholderMessageId === "number" &&
    !!chatId &&
    (deletePlaceholder || html.length > TELEGRAM_MESSAGE_LIMIT);

  if (shouldDeletePlaceholder) {
    void ctx.telegram.deleteMessage(chatId, placeholderMessageId).catch(() => {});
  }

  const chunks = splitMessage(raw);
  for (const chunk of chunks) {
    await replyWithFallback(ctx, chunk, false);
  }
}

function startTyping(ctx: Context) {
  void ctx.sendChatAction("typing").catch(() => {});
  const interval = setInterval(() => {
    void ctx.sendChatAction("typing").catch(() => {});
  }, 4000);

  return () => clearInterval(interval);
}

function getBillingErrorMessage(error: unknown) {
  if (error instanceof Error) {
    switch (error.message) {
      case "INSUFFICIENT_BALANCE":
        return "Недостаточно баланса.";
      case "DAILY_LIMIT_EXCEEDED":
        return "Превышен дневной лимит.";
      case "MONTHLY_LIMIT_EXCEEDED":
        return "Превышен месячный лимит.";
      case "ORG_BUDGET_EXCEEDED":
        return "Превышен бюджет организации.";
      default:
        return "Не удалось списать кредиты.";
    }
  }

  return "Не удалось списать кредиты.";
}

async function getAuthorizedUser(ctx: Context): Promise<User | null> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { telegramId },
  });

  if (!user) {
    await ctx.reply("Сначала авторизуйтесь через /start <token>.");
    return null;
  }

  if (user.isActive === false) {
    await ctx.reply("Ваш аккаунт деактивирован. Обратитесь к администратору.");
    return null;
  }

  return user;
}

async function handleUserPrompt(ctx: Context, user: User, content: string) {
  const clean = content.trim();
  if (!clean) return;

  const modelId = await resolveModel(user.id);
  const org = user.orgId
    ? await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { settings: true },
      })
    : null;
  const modelPolicy = getOrgModelPolicy(org?.settings ?? null);
  if (!isModelAllowed(modelId, modelPolicy)) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user.orgId,
      actorId: user.id,
      targetType: "model",
      targetId: modelId,
      metadata: { source: "telegram" },
    });
    await ctx.reply("Выбранная модель запрещена политикой организации.");
    return;
  }

  const dlpPolicy = getOrgDlpPolicy(org?.settings ?? null);
  const dlpOutcome = evaluateDlp(clean, dlpPolicy);
  if (dlpOutcome.action === "block") {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user.orgId,
      actorId: user.id,
      targetType: "dlp",
      targetId: null,
      metadata: { source: "telegram", matches: dlpOutcome.matches },
    });
    await ctx.reply("Запрос отклонен политикой DLP.");
    return;
  }
  if (dlpOutcome.action === "redact") {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user.orgId,
      actorId: user.id,
      targetType: "dlp",
      targetId: null,
      metadata: { source: "telegram", action: "redact" },
    });
  }
  const finalContent =
    dlpOutcome.action === "redact" && dlpOutcome.redactedText
      ? dlpOutcome.redactedText
      : clean;
  const chat = await getOrCreateChat(user.id, modelId);

  await prisma.message.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      costCenterId: user.costCenterId ?? undefined,
      role: "USER",
      content: finalContent,
      tokenCount: 0,
      cost: 0,
      modelId,
    },
  });

  const history = await fetchChatMessages(chat.id);
  const trimmed = trimMessages(history);

  const stopTyping = startTyping(ctx);
  const placeholder = await ctx.reply("⏳ Готовлю ответ...");

  await logEvent({
    type: "AI_REQUEST",
    userId: user.id,
    chatId: chat.id,
    modelId,
    payload: {
      model: modelId,
      messageCount: trimmed.length,
      source: "telegram",
    },
  });

  try {
    const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: getOpenRouterHeaders(),
      body: JSON.stringify({
        model: modelId,
        messages: trimmed,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      await sendReply(
        ctx,
        "Модель временно недоступна. Попробуйте позже.",
        placeholder.message_id
      );
      return;
    }

    if (!response.body) {
      await sendReply(
        ctx,
        "Не удалось получить поток ответа. Попробуйте позже.",
        placeholder.message_id
      );
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantText = "";
    let usage:
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | null = null;
    let lastEditAt = 0;
    let lastEditLength = 0;
    let exceededLimit = false;

    const chatId = ctx.chat?.id;
    const tryEdit = async (force = false) => {
      if (!chatId || exceededLimit) return;
      const now = Date.now();
      const minInterval = 900;
      const minDelta = 60;

      if (!force) {
        if (now - lastEditAt < minInterval) return;
        if (assistantText.length - lastEditLength < minDelta) return;
      }

      const html = renderTelegramHtml(assistantText);
      if (html.length > TELEGRAM_MESSAGE_LIMIT) {
        exceededLimit = true;
        return;
      }

      try {
        await ctx.telegram.editMessageText(
          chatId,
          placeholder.message_id,
          undefined,
          html,
          { parse_mode: "HTML" }
        );
        lastEditAt = now;
        lastEditLength = assistantText.length;
      } catch {
        // ignore edit failures during stream
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith("data:")) continue;
        const payload = trimmedLine.replace(/^data:\s*/, "");
        if (!payload || payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            assistantText += delta;
          }

          if (parsed?.usage) {
            usage = parsed.usage;
          }
        } catch {
          // ignore malformed chunks
        }
      }

      await tryEdit();
    }

    await tryEdit(true);
    let cost = 0;
    let tokenCount = 0;

    if (usage) {
      tokenCount = usage.total_tokens ?? 0;
      try {
        const creditsResult = await calculateCreditsFromUsage({
          modelId,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          apiKey: undefined,
        });

        cost = creditsResult.credits;

        if (creditsResult.credits > 0) {
          await spendCredits({
            userId: user.id,
            amount: creditsResult.credits,
            description: `OpenRouter ${modelId}`,
          });
        }
      } catch (error) {
        console.error("Telegram billing failed", error);
        await logEvent({
          type: "BILLING_ERROR",
          userId: user.id,
          chatId: chat.id,
          modelId,
          message: error instanceof Error ? error.message : "Billing error",
        });
      }
    }

    await prisma.message.create({
      data: {
        chatId: chat.id,
        userId: user.id,
        costCenterId: user.costCenterId ?? undefined,
        role: "ASSISTANT",
        content: assistantText,
        tokenCount,
        cost,
        modelId,
      },
    });

    await prisma.chat.update({
      where: { id: chat.id },
      data: { updatedAt: new Date() },
    });

    await sendReply(ctx, assistantText, placeholder.message_id);
  } catch (error) {
    console.error("Telegram OpenRouter failed", error);
    await logEvent({
      type: "AI_ERROR",
      userId: user.id,
      chatId: chat.id,
      modelId,
      message: error instanceof Error ? error.message : "OpenRouter error",
    });
    await sendReply(
      ctx,
      "Ошибка запроса к модели. Попробуйте позже.",
      placeholder.message_id
    );
  } finally {
    stopTyping();
  }
}

bot.start(async (ctx) => {
  const text = ctx.message.text ?? "";
  const [, token] = text.split(" ");

  if (token) {
    await ctx.reply("Токен получен. Идет привязка аккаунта...");

    const record = await prisma.telegramLinkToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      await ctx.reply("Токен недействителен или истек. Сгенерируйте новый.");
      return;
    }

    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) {
      await ctx.reply("Не удалось получить Telegram ID.");
      return;
    }

    const existing = await prisma.user.findUnique({
      where: { telegramId },
      select: { id: true },
    });

    if (existing && existing.id !== record.userId) {
      await ctx.reply("Этот Telegram уже привязан к другому аккаунту.");
      return;
    }

    await prisma.user.update({
      where: { id: record.userId },
      data: { telegramId },
    });

    await prisma.telegramLinkToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    await ctx.reply(
      "Аккаунт привязан. Выберите модель:",
      Markup.inlineKeyboard([
        Markup.button.callback("GPT-4o", "model:openai/gpt-4o"),
        Markup.button.callback("Claude 3.5", "model:anthropic/claude-3.5-sonnet"),
      ])
    );
    return;
  }

  await ctx.reply(
    "Добро пожаловать в PlatformaAI. Используйте /start <token> для авторизации."
  );
});

bot.action(/model:(.+)/, async (ctx) => {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, orgId: true, org: { select: { settings: true } } },
  });

  if (!user) {
    await ctx.reply("Сначала авторизуйтесь через /start <token>.");
    return;
  }

  const modelId = ctx.match[1];
  const modelPolicy = getOrgModelPolicy(user.org?.settings ?? null);
  if (!isModelAllowed(modelId, modelPolicy)) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user.orgId,
      actorId: user.id,
      targetType: "model",
      targetId: modelId,
      metadata: { source: "telegram" },
    });
    await ctx.answerCbQuery("Эта модель запрещена политикой организации.", {
      show_alert: true,
    });
    return;
  }

  await updateSettings(user.id, { telegramModel: modelId });
  await ctx.answerCbQuery(`Модель ${modelId} выбрана`);
});

bot.on("text", async (ctx) => {
  const content = ctx.message.text ?? "";
  if (!content || content.startsWith("/")) return;

  const user = await getAuthorizedUser(ctx);
  if (!user) return;

  await handleUserPrompt(ctx, user, content);
});

bot.on("voice", async (ctx) => {
  const user = await getAuthorizedUser(ctx);
  if (!user) return;

  const voice = ctx.message.voice;
  if (!voice) return;

  const chatId = ctx.chat?.id;
  const statusMessage = await ctx.reply("🎙 Распознаю голос...");

  try {
    const fileLink = await ctx.telegram.getFileLink(voice.file_id);
    const transcript = await transcribeAudio({
      fileUrl: fileLink.toString(),
      fileName: `${voice.file_id}.ogg`,
      mimeType: "audio/ogg",
    });

    if (!transcript.trim()) {
      if (chatId) {
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage.message_id,
          undefined,
          "Не удалось распознать речь."
        );
      } else {
        await ctx.reply("Не удалось распознать речь.");
      }
      return;
    }

    const sttCost = calculateCreditsFromStt({
      durationSeconds: voice.duration ?? 0,
    });

    if (sttCost.credits > 0) {
      try {
        await spendCredits({
          userId: user.id,
          amount: sttCost.credits,
          description: `Whisper STT (${voice.duration ?? 0}s)`,
        });
      } catch (error) {
        await logEvent({
          type: "BILLING_ERROR",
          userId: user.id,
          message: error instanceof Error ? error.message : "Billing error",
          payload: { source: "stt", duration: voice.duration ?? 0 },
        });
        const message = getBillingErrorMessage(error);
        if (chatId) {
          await ctx.telegram.editMessageText(
            chatId,
            statusMessage.message_id,
            undefined,
            message
          );
        } else {
          await ctx.reply(message);
        }
        return;
      }
    }

    if (chatId) {
      await ctx.telegram.editMessageText(
        chatId,
        statusMessage.message_id,
        undefined,
        "Распознано. Генерирую ответ..."
      );
    }

    await handleUserPrompt(ctx, user, transcript);

    if (chatId) {
      void ctx.telegram.deleteMessage(chatId, statusMessage.message_id).catch(() => {});
    }
  } catch (error) {
    console.error("Telegram Whisper failed", error);
    await logEvent({
      type: "STT_ERROR",
      userId: user.id,
      message: error instanceof Error ? error.message : "STT error",
      payload: { duration: voice.duration ?? 0 },
    });
    if (chatId) {
      await ctx.telegram.editMessageText(
        chatId,
        statusMessage.message_id,
        undefined,
        "Ошибка распознавания голоса."
      );
    } else {
      await ctx.reply("Ошибка распознавания голоса.");
    }
  }
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
