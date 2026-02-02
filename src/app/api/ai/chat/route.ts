import { NextResponse } from "next/server";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";
import { trimMessages } from "@/lib/context";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculateCreditsFromUsage } from "@/lib/pricing";
import {
  commitAiQuotaHold,
  preflightCredits,
  releaseAiQuotaHold,
  reserveAiQuotaHold,
  spendCredits,
  type AiQuotaHold,
} from "@/lib/billing";
import { mapBillingError } from "@/lib/billing-errors";
import {
  estimateChatPromptTokens,
  estimateUpperBoundCredits,
} from "@/lib/quota-estimation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/telemetry";
import { getUserOpenRouterKey } from "@/lib/user-settings";
import { buildPersonalizationSystemPrompt } from "@/lib/personalization";
import { searchWeb } from "@/lib/search";
import { checkModeration } from "@/lib/moderation";
import { getOrgDlpPolicy, getOrgModelPolicy } from "@/lib/org-settings";
import {
  validateModelPolicy,
  filterFallbackModels,
  applyDlpToMessages,
} from "@/lib/ai-authorization";
import { findOwnedChat } from "@/lib/chat-ownership";
import { resolveOrgCostCenterId } from "@/lib/cost-centers";
import { HttpError } from "@/lib/http-error";
import {
  buildCacheKey,
  getCachedResponse,
  setCachedResponse,
} from "@/lib/cache";
import { updateChatSummary } from "@/lib/summary";
import { requestSchema } from "@/lib/chat-request-schema";

export async function POST(request: Request) {
  const session = await auth(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const rate = checkRateLimit({
    key: `ai:${session.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });

  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAt: rate.resetAt },
      { status: 429 }
    );
  }

  const allowUserKey =
    process.env.AUTH_BYPASS === "1" ||
    process.env.ALLOW_USER_OPENROUTER_KEYS === "1";

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      balance: true,
      settings: true,
      costCenterId: true,
      orgId: true,
    },
  });

  if (!user || Number(user.balance) <= 0) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 402 });
  }

  const org = user.orgId
    ? await prisma.organization.findUnique({
        where: { id: user.orgId },
        select: { settings: true },
      })
    : null;
  const modelPolicy = getOrgModelPolicy(org?.settings ?? null);
  const dlpPolicy = getOrgDlpPolicy(org?.settings ?? null);

  const parsedBody = requestSchema.safeParse(await request.json());
  if (!parsedBody.success) {
    const hasChatIdIssue = parsedBody.error.issues.some(
      (issue) => issue.path[0] === "chatId"
    );
    return NextResponse.json(
      { error: hasChatIdIssue ? "chatId is required" : "Invalid request" },
      { status: 400 }
    );
  }
  const body = parsedBody.data;
  const chatId = body.chatId;
  const buildBillingErrorResponse = (message: string) => {
    const result = mapBillingError(message);
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  };
  const ownedChat = await findOwnedChat({
    chatId,
    userId: session.user.id,
    select: {
      summary: true,
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ownedChat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let costCenterId: string | undefined = undefined;
  if (body.costCenterId && !user.orgId) {
    return NextResponse.json(
      { error: "costCenterId requires organization" },
      { status: 400 }
    );
  }
  if (user.orgId) {
    const membership = await prisma.orgMembership.findUnique({
      where: {
        orgId_userId: {
          orgId: user.orgId,
          userId: session.user.id,
        },
      },
      select: {
        id: true,
        defaultCostCenterId: true,
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      costCenterId = await resolveOrgCostCenterId({
        orgId: user.orgId,
        membershipId: membership.id,
        requestedCostCenterId: body.costCenterId ?? null,
        defaultCostCenterId: membership.defaultCostCenterId,
        fallbackCostCenterId: user.costCenterId,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }
  const modelValidation = await validateModelPolicy({
    modelId: body.model,
    policy: modelPolicy,
    audit: {
      orgId: user.orgId,
      actorId: session.user.id,
      targetId: body.model,
    },
  });

  if (!modelValidation.ok) {
    return NextResponse.json(
      { error: modelValidation.error },
      { status: modelValidation.status }
    );
  }

  const allowedFallbacks = filterFallbackModels(
    body.fallbackModels ?? [],
    modelPolicy
  );

  const personalization = buildPersonalizationSystemPrompt(
    user?.settings ?? null
  );

  const systemMessages: Array<{ role: "system"; content: string }> = [];
  if (personalization) {
    systemMessages.push({ role: "system", content: personalization });
  }

  let attachmentMessages: Array<{ role: "system"; content: string }> = [];
  if (ownedChat.summary?.trim()) {
    systemMessages.push({
      role: "system",
      content: `Контекст диалога:\n${ownedChat.summary}`,
    });
  }

  attachmentMessages = (ownedChat.attachments ?? [])
    .filter((attachment) => attachment.textContent?.trim())
    .slice(-3)
    .map((attachment) => ({
      role: "system" as const,
      content: [
        `Файл: ${attachment.filename} (${attachment.mimeType})`,
        attachment.textContent.slice(0, 6000),
      ].join("\n"),
    }));

  if (body.useWebSearch) {
    const lastUserMessage = [...body.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (lastUserMessage) {
      try {
        const results = await searchWeb(lastUserMessage.content, 5);
        if (results.length) {
          const sources = results
            .map(
              (result, index) =>
                `[${index + 1}] ${result.title} — ${result.url}\n${result.snippet}`
            )
            .join("\n\n");
          systemMessages.push({
            role: "system",
            content: [
              "Ниже результаты веб‑поиска. Используй их в ответе и ссылайся в формате [1], [2].",
              sources,
            ].join("\n\n"),
          });
        }
      } catch (error) {
        await logEvent({
          type: "AI_ERROR",
          userId: session.user.id,
          chatId: body.chatId,
          modelId: body.model,
          message: error instanceof Error ? error.message : "Search error",
        });
      }
    }
  }

  const dlpResult = await applyDlpToMessages({
    messages: body.messages,
    policy: dlpPolicy,
    audit: {
      orgId: user.orgId,
      actorId: session.user.id,
      targetId: body.chatId ?? null,
    },
  });

  if (!dlpResult.ok) {
    return NextResponse.json(
      { error: dlpResult.error },
      { status: dlpResult.status }
    );
  }

  const safeMessages = dlpResult.messages ?? body.messages;

  const enrichedMessages = [
    ...systemMessages,
    ...attachmentMessages,
    ...safeMessages,
  ];

  for (const message of safeMessages) {
    if (message.role !== "user") continue;
    const moderation = checkModeration(message.content);
    if (!moderation.ok) {
      await logEvent({
        type: "AI_ERROR",
        userId: session.user.id,
        chatId: body.chatId,
        modelId: body.model,
        message: moderation.reason,
      });
      return NextResponse.json(
        { error: "Запрос отклонен модерацией." },
        { status: 400 }
      );
    }
  }

  const trimmedMessages = trimMessages(enrichedMessages, body.contextLength);

  const userKey = allowUserKey
    ? getUserOpenRouterKey(user?.settings ?? null)
    : undefined;

  const idempotencyKey = crypto.randomUUID();
  let quotaHold: AiQuotaHold | null = null;

  try {
    const promptTokensEstimate = estimateChatPromptTokens(trimmedMessages);
    const estimatedCredits = await estimateUpperBoundCredits({
      modelId: body.model,
      promptTokensEstimate,
      maxTokens: body.max_tokens,
      apiKey: userKey,
    });

    const reserveAmount = Math.max(1, estimatedCredits);
    quotaHold = await reserveAiQuotaHold({
      userId: session.user.id,
      amount: reserveAmount,
      idempotencyKey,
      costCenterId,
    });

    if (!quotaHold) {
      await preflightCredits({
        userId: session.user.id,
        minAmount: reserveAmount,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "BILLING_ERROR";
    const mapped = mapBillingError(message);
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    return NextResponse.json({ error: "Billing error" }, { status: 500 });
  }

  await logEvent({
    type: "AI_REQUEST",
    userId: session.user.id,
    chatId: body.chatId,
    modelId: body.model,
    payload: {
      model: body.model,
      stream: body.stream ?? true,
      messageCount: trimmedMessages.length,
    },
  });
  const baseUrl = getOpenRouterBaseUrl();
  let requestHeaders: Record<string, string>;

  try {
    requestHeaders = getOpenRouterHeaders(userKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing config";
    await releaseAiQuotaHold({ hold: quotaHold });
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: body.model,
      message,
    });

    const status = message.includes("OPENROUTER_API_KEY") ? 401 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }

  const useCache = body.cache !== false;
  const cacheKey = useCache
    ? buildCacheKey({
        userId: session.user.id,
        model: body.model,
        messages: trimmedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      })
    : null;

  const cached = cacheKey ? getCachedResponse(cacheKey) : null;
  if (cached) {
    let creditsResult = { credits: 0 };
    try {
      if (cached.usage) {
        creditsResult = await calculateCreditsFromUsage({
          modelId: cached.modelId,
          promptTokens: cached.usage.prompt_tokens ?? 0,
          completionTokens: cached.usage.completion_tokens ?? 0,
          apiKey: userKey,
        });
      }

      if (creditsResult.credits > 0) {
        await spendCredits({
          userId: session.user.id,
          amount: creditsResult.credits,
          description: `OpenRouter ${cached.modelId} (cache)`,
          costCenterId,
        });
      }

      await commitAiQuotaHold({ hold: quotaHold, finalAmount: creditsResult.credits });
      quotaHold = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing error";
      await releaseAiQuotaHold({ hold: quotaHold });
      await logEvent({
        type: "BILLING_ERROR",
        userId: session.user.id,
        chatId,
        modelId: cached.modelId,
        message,
      });
      return buildBillingErrorResponse(message);
    }

    await prisma.message.create({
      data: {
        chatId,
        userId: session.user.id,
        costCenterId,
        role: "ASSISTANT",
        content: cached.content,
        tokenCount: cached.usage?.total_tokens ?? 0,
        cost: creditsResult.credits,
        modelId: cached.modelId,
      },
    });

    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });
    void updateChatSummary({
      chatId,
      userId: session.user.id,
      apiKey: userKey,
    });

    if (!body.stream) {
      return NextResponse.json({
        choices: [{ message: { content: cached.content } }],
        usage: cached.usage ?? null,
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const payload = JSON.stringify({
          choices: [{ delta: { content: cached.content } }],
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const modelsToTry = [body.model, ...allowedFallbacks];
  let response: Response | null = null;
  let usedModel = body.model;

  try {
    for (const modelId of modelsToTry) {
      usedModel = modelId;
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          model: modelId,
          messages: trimmedMessages,
          temperature: body.temperature,
          max_tokens: body.max_tokens,
          stream: body.stream ?? true,
          stream_options: { include_usage: true },
        }),
      });

      if (response.ok) {
        break;
      }

      if (![429, 503].includes(response.status)) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } catch (error) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const message = error instanceof Error ? error.message : "OpenRouter error";
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: usedModel,
      message,
    });
    return NextResponse.json({ error: "OpenRouter error" }, { status: 502 });
  }

  if (!response || !response.ok) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const text = response ? await response.text() : "No response";
    const status = response?.status ?? 502;
    let message = "OpenRouter error";
    if (status === 401) {
      message = userKey
        ? "OpenRouter: неверный ключ. Проверьте ключ в настройках."
        : "OpenRouter: ключ из .env.local недействителен или отсутствует.";
    }
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: usedModel,
      payload: {
        status,
        details: text.slice(0, 500),
        model: usedModel,
      },
    });
    return NextResponse.json(
      { error: message, details: text },
      { status }
    );
  }

  if (!body.stream) {
    let data = await response.json();
    let usage = data?.usage;
    let assistantContent = data?.choices?.[0]?.message?.content ?? "";

    if (!assistantContent.trim() && modelsToTry.length > 1) {
      const fallback = modelsToTry.find((modelId) => modelId !== usedModel);
      if (fallback) {
        const fallbackResponse = await fetch(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify({
              model: fallback,
              messages: trimmedMessages,
              temperature: body.temperature,
              max_tokens: body.max_tokens,
              stream: false,
            }),
          }
        );

        if (fallbackResponse.ok) {
          usedModel = fallback;
          data = await fallbackResponse.json();
          usage = data?.usage;
          assistantContent = data?.choices?.[0]?.message?.content ?? "";
        }
      }
    }

    let creditsResult = { credits: 0 };
    const tokenCount = usage?.total_tokens ?? 0;

    try {
      if (usage) {
        creditsResult = await calculateCreditsFromUsage({
          modelId: usedModel,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          apiKey: userKey,
        });

        if (creditsResult.credits > 0) {
          await spendCredits({
            userId: session.user.id,
            amount: creditsResult.credits,
            description: `OpenRouter ${usedModel}`,
            costCenterId,
          });
        }
      }

      await commitAiQuotaHold({ hold: quotaHold, finalAmount: creditsResult.credits });
      quotaHold = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing error";
      await releaseAiQuotaHold({ hold: quotaHold });
      await logEvent({
        type: "BILLING_ERROR",
        userId: session.user.id,
        chatId,
        modelId: usedModel,
        message,
      });
      return buildBillingErrorResponse(message);
    }

    await prisma.message.create({
      data: {
        chatId,
        userId: session.user.id,
        costCenterId,
        role: "ASSISTANT",
        content: assistantContent,
        tokenCount,
        cost: creditsResult.credits,
        modelId: usedModel,
      },
    });

    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    if (useCache) {
      const finalCacheKey = buildCacheKey({
        userId: session.user.id,
        model: usedModel,
        messages: trimmedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      });
      setCachedResponse(finalCacheKey, {
        content: assistantContent,
        usage,
        modelId: usedModel,
        createdAt: Date.now(),
      });
    }

    return NextResponse.json(data);
  }

  const streamHeaders = new Headers(response.headers);
  streamHeaders.set("Content-Type", "text/event-stream");
  streamHeaders.set("Cache-Control", "no-cache");
  streamHeaders.set("Connection", "keep-alive");

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let assistantText = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;
  let sentAny = false;
  const reader = response.body?.getReader();

  if (!reader) {
    await releaseAiQuotaHold({ hold: quotaHold });
    return NextResponse.json({ error: "OpenRouter error" }, { status: 502 });
  }

  async function finalizeStream() {
    let creditsResult = { credits: 0 };
    const tokenCount = usage?.total_tokens ?? 0;

    try {
      if (usage) {
        creditsResult = await calculateCreditsFromUsage({
          modelId: usedModel,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          apiKey: userKey,
        });

        if (creditsResult.credits > 0) {
          await spendCredits({
            userId,
            amount: creditsResult.credits,
            description: `OpenRouter ${usedModel}`,
            costCenterId,
          });
        }
      }

      await commitAiQuotaHold({ hold: quotaHold, finalAmount: creditsResult.credits });
      quotaHold = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing error";
      await releaseAiQuotaHold({ hold: quotaHold });
      await logEvent({
        type: "BILLING_ERROR",
        userId,
        chatId,
        modelId: usedModel,
        message,
      });
    }

    await prisma.message.create({
      data: {
        chatId,
        userId,
        costCenterId,
        role: "ASSISTANT",
        content: assistantText,
        tokenCount,
        cost: creditsResult.credits,
        modelId: usedModel,
      },
    });

    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });
    void updateChatSummary({
      chatId,
      userId,
      apiKey: userKey,
    });

    if (useCache && assistantText.trim()) {
      const finalCacheKey = buildCacheKey({
        userId,
        model: usedModel,
        messages: trimmedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      });
      setCachedResponse(finalCacheKey, {
        content: assistantText,
        usage: usage ?? undefined,
        modelId: usedModel,
        createdAt: Date.now(),
      });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          sentAny = true;
          controller.enqueue(value);

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;

            const payload = trimmed.replace(/^data:\s*/, "");
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
              // Ignore malformed chunks
            }
          }
        }

        if (!assistantText.trim() && !sentAny && modelsToTry.length > 1) {
          const fallback = modelsToTry.find((modelId) => modelId !== usedModel);
          if (fallback) {
            const fallbackResponse = await fetch(
              `${baseUrl}/chat/completions`,
              {
                method: "POST",
                headers: requestHeaders,
                body: JSON.stringify({
                  model: fallback,
                  messages: trimmedMessages,
                  temperature: body.temperature,
                  max_tokens: body.max_tokens,
                  stream: false,
                }),
              }
            );

            if (fallbackResponse.ok) {
              const fallbackData = await fallbackResponse.json();
              const fallbackText =
                fallbackData?.choices?.[0]?.message?.content ?? "";
              const fallbackUsage = fallbackData?.usage ?? null;
              if (fallbackText.trim()) {
                usedModel = fallback;
                assistantText = fallbackText;
                usage = fallbackUsage;
                const payload = JSON.stringify({
                  choices: [{ delta: { content: fallbackText } }],
                });
                controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              }
            }
          }
        }
      } finally {
        controller.close();
        void finalizeStream();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: streamHeaders,
  });
}
