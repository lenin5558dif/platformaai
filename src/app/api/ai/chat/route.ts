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
import { fetchWithTimeout, isFetchTimeoutError } from "@/lib/fetch-timeout";
import {
  estimateChatPromptTokens,
  estimateUpperBoundCredits,
} from "@/lib/quota-estimation";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/telemetry";
import { buildPersonalizationSystemPrompt } from "@/lib/personalization";
import { searchWeb } from "@/lib/search";
import { checkModeration } from "@/lib/moderation";
import { getOrgDlpPolicy, getOrgModelPolicy } from "@/lib/org-settings";
import { filterFreeOpenRouterModelIds } from "@/lib/models";
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
import { getPlatformConfig } from "@/lib/platform-config";
import { resolveOpenRouterApiKey } from "@/lib/provider-credentials";
import { getOpenRouterRateLimitPayload } from "@/lib/openrouter-metrics";
import {
  getBillingTier,
  getBillingTierLabel,
  isFreeBillingTier,
} from "@/lib/billing-tiers";

const OPENROUTER_CHAT_TIMEOUT_MS = 30_000;

function buildOpenRouterChatBody(params: {
  model: string;
  fallbackModels?: string[];
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  includeUsage?: boolean;
}) {
  return {
    model: params.model,
    ...(params.fallbackModels?.length ? { models: params.fallbackModels } : {}),
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    stream: params.stream,
    ...(params.includeUsage ? { stream_options: { include_usage: true } } : {}),
  };
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Сессия истекла. Войдите снова.", code: "AUTH_UNAUTHORIZED" },
      { status: 401 }
    );
  }
  const userId = session.user.id;

  const rate = await checkRateLimit({
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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      balance: true,
      settings: true,
      costCenterId: true,
      orgId: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const billingTier = getBillingTier(user.settings, user.balance);
  const billingTierLabel = getBillingTierLabel(billingTier);

  const [org, platformConfig, openRouterApiKey] = await Promise.all([
    user.orgId
      ? prisma.organization.findUnique({
          where: { id: user.orgId },
          select: { settings: true },
        })
      : null,
    getPlatformConfig(),
    resolveOpenRouterApiKey({ userId: user.id, orgId: user.orgId }),
  ]);
  const modelPolicy = getOrgModelPolicy(org?.settings ?? null);
  const dlpPolicy = getOrgDlpPolicy(org?.settings ?? null);
  const globalDisabledModels = new Set(
    platformConfig.disabledModelIds
      .map((modelId) => modelId.trim().toLowerCase())
      .filter((modelId) => modelId.length > 0)
  );
  const isGloballyDisabled = (modelId: string) =>
    globalDisabledModels.has(modelId.trim().toLowerCase());

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

  if (isGloballyDisabled(body.model)) {
    return NextResponse.json(
      { error: "Модель временно отключена администратором платформы." },
      { status: 403 }
    );
  }

  const rawAllowedFallbacks = filterFallbackModels(
    body.fallbackModels ?? [],
    modelPolicy
  ).filter((modelId) => !isGloballyDisabled(modelId));
  const isFreeTier = isFreeBillingTier(billingTier);
  let allowedFallbacks = rawAllowedFallbacks;
  let modelsToTry = [body.model, ...allowedFallbacks];
  let reserveEstimateModelId = body.model;
  let requiresPaidBilling = true;

  if (isFreeTier) {
    const candidateModelIds = [body.model, ...rawAllowedFallbacks];
    let freeModelIds: Set<string>;

    try {
      freeModelIds = new Set(
        await filterFreeOpenRouterModelIds(candidateModelIds, openRouterApiKey ?? undefined)
      );
    } catch (error) {
      await logEvent({
        type: "AI_ERROR",
        userId: session.user.id,
        chatId: body.chatId,
        modelId: body.model,
        message:
          error instanceof Error
            ? `Free model lookup failed: ${error.message}`
            : "Free model lookup failed",
      });
      return NextResponse.json(
        { error: "OpenRouter models error" },
        { status: 503 }
      );
    }

    const requestedModelIsFree = freeModelIds.has(body.model);

    if (!requestedModelIsFree) {
      return NextResponse.json(
        { error: `Модель недоступна на тарифе ${billingTierLabel}.` },
        { status: 402 }
      );
    }

    allowedFallbacks = rawAllowedFallbacks.filter((modelId) => freeModelIds.has(modelId));
    modelsToTry = [body.model, ...allowedFallbacks];
    reserveEstimateModelId = body.model;
    requiresPaidBilling = false;
  }

  const personalization = buildPersonalizationSystemPrompt(
    user?.settings ?? null
  );

  const systemMessages: Array<{ role: "system"; content: string }> = [];
  if (platformConfig.globalSystemPrompt?.trim()) {
    systemMessages.push({
      role: "system",
      content: platformConfig.globalSystemPrompt.trim(),
    });
  }
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

  const idempotencyKey = crypto.randomUUID();
  let quotaHold: AiQuotaHold | null = null;

  if (requiresPaidBilling) {
    try {
      const promptTokensEstimate = estimateChatPromptTokens(trimmedMessages);
      const estimatedCredits = await estimateUpperBoundCredits({
        modelId: reserveEstimateModelId,
        promptTokensEstimate,
        maxTokens: body.max_tokens,
        apiKey: openRouterApiKey ?? undefined,
      });

      const reserveAmount = Math.max(0, Math.ceil(estimatedCredits));
      if (reserveAmount > 0) {
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
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "BILLING_ERROR";
      const mapped = mapBillingError(message);
      if (mapped) {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      return NextResponse.json({ error: "Billing error" }, { status: 500 });
    }
  }

  const baseUrl = getOpenRouterBaseUrl();
  let requestHeaders: Record<string, string>;

  if (!openRouterApiKey) {
    await releaseAiQuotaHold({ hold: quotaHold });
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: body.model,
      message: "OPENROUTER_API_KEY is not set",
      payload: {
        source: "web",
        orgId: user.orgId ?? null,
      },
    });
    return NextResponse.json(
      { error: "OpenRouter API key is not configured" },
      { status: 401 }
    );
  }

  try {
    requestHeaders = getOpenRouterHeaders(openRouterApiKey);
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

  const cached = cacheKey ? await getCachedResponse(cacheKey) : null;
  if (cached) {
    let creditsResult = { credits: 0 };
    try {
      if (cached.usage) {
        creditsResult = await calculateCreditsFromUsage({
          modelId: cached.modelId,
          promptTokens: cached.usage.prompt_tokens ?? 0,
          completionTokens: cached.usage.completion_tokens ?? 0,
          apiKey: openRouterApiKey ?? undefined,
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
    });

    const streamMode = body.stream ?? true;

    await logEvent({
      type: "AI_REQUEST",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: cached.modelId,
      payload: {
        source: "web",
        model: cached.modelId,
        stream: streamMode,
        messageCount: trimmedMessages.length,
        cacheHit: true,
      },
    });

    if (!streamMode) {
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

  const providerRequestStartedAt = Date.now();
  const streamMode = body.stream ?? true;
  let response: Response | null = null;
  let usedModel = body.model;
  let lastFetchError: unknown = null;

  try {
    response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(buildOpenRouterChatBody({
        model: body.model,
        fallbackModels: allowedFallbacks,
        messages: trimmedMessages,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        stream: streamMode,
        includeUsage: streamMode,
      })),
      timeoutMs: OPENROUTER_CHAT_TIMEOUT_MS,
      timeoutLabel: "OpenRouter chat completion",
    });
  } catch (error) {
    lastFetchError = error;
    response = null;

    const fallback = modelsToTry.find((modelId) => modelId !== body.model);
    if (fallback) {
      usedModel = fallback;
      try {
        response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify(buildOpenRouterChatBody({
            model: fallback,
            messages: trimmedMessages,
            temperature: body.temperature,
            maxTokens: body.max_tokens,
            stream: streamMode,
            includeUsage: streamMode,
          })),
          timeoutMs: OPENROUTER_CHAT_TIMEOUT_MS,
          timeoutLabel: "OpenRouter chat local fallback",
        });
        lastFetchError = null;
      } catch (fallbackError) {
        lastFetchError = fallbackError;
        response = null;
      }
    }
  }

  if ((!response || !response.ok) && lastFetchError) {
    await releaseAiQuotaHold({ hold: quotaHold });
    quotaHold = null;
    const message =
      lastFetchError instanceof Error ? lastFetchError.message : "OpenRouter error";
    const status = isFetchTimeoutError(lastFetchError) ? 504 : 502;
    const durationMs = Date.now() - providerRequestStartedAt;
    await logEvent({
      type: "AI_REQUEST",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: usedModel,
      payload: {
        source: "web",
        model: usedModel,
        stream: streamMode,
        messageCount: trimmedMessages.length,
        status,
        durationMs,
        error: true,
      },
    });
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: usedModel,
      message,
      payload: {
        source: "web",
        durationMs,
      },
    });
    return NextResponse.json(
      {
        error: isFetchTimeoutError(lastFetchError)
          ? "OpenRouter timeout"
          : "OpenRouter error",
      },
      { status }
    );
  }

  if (!response || !response.ok) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const text = response ? await response.text() : "No response";
    const status = response?.status ?? 502;
    const durationMs = Date.now() - providerRequestStartedAt;
    const rateLimitPayload = getOpenRouterRateLimitPayload(response?.headers);
    let message = "OpenRouter error";
    if (status === 401) {
      message = "OpenRouter: ключ недействителен или отсутствует.";
    }
    await logEvent({
      type: "AI_REQUEST",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: usedModel,
      payload: {
        source: "web",
        model: usedModel,
        stream: streamMode,
        messageCount: trimmedMessages.length,
        status,
        durationMs,
        error: true,
        ...rateLimitPayload,
      },
    });
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: usedModel,
      payload: {
        status,
        details: text.slice(0, 500),
        model: usedModel,
        durationMs,
        source: "web",
        ...rateLimitPayload,
      },
    });
    return NextResponse.json(
      { error: message, details: text },
      { status }
    );
  }

  if (!streamMode) {
    let data = await response.json();
    let usage = data?.usage;
    let assistantContent = data?.choices?.[0]?.message?.content ?? "";
    let telemetryHeaders: Headers | null = response.headers;
    if (typeof data?.model === "string" && data.model.trim()) {
      usedModel = data.model;
    }

    if (!assistantContent.trim() && modelsToTry.length > 1) {
      const fallback = modelsToTry.find((modelId) => modelId !== usedModel);
      if (fallback) {
        let fallbackResponse: Response | null = null;
        try {
          fallbackResponse = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(buildOpenRouterChatBody({
              model: fallback,
              messages: trimmedMessages,
              temperature: body.temperature,
              maxTokens: body.max_tokens,
              stream: false,
            })),
            timeoutMs: OPENROUTER_CHAT_TIMEOUT_MS,
            timeoutLabel: "OpenRouter chat fallback",
          });
        } catch {
          fallbackResponse = null;
        }

        if (fallbackResponse?.ok) {
          usedModel = fallback;
          data = await fallbackResponse.json();
          usage = data?.usage;
          assistantContent = data?.choices?.[0]?.message?.content ?? "";
          telemetryHeaders = fallbackResponse.headers;
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
          apiKey: openRouterApiKey ?? undefined,
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
      await setCachedResponse(finalCacheKey, {
        content: assistantContent,
        usage,
        modelId: usedModel,
        createdAt: Date.now(),
      });
    }

    await logEvent({
      type: "AI_REQUEST",
      userId: session.user.id,
      chatId: body.chatId,
      modelId: usedModel,
      payload: {
        source: "web",
        model: usedModel,
        stream: false,
        messageCount: trimmedMessages.length,
        status: 200,
        durationMs: Date.now() - providerRequestStartedAt,
        totalTokens: tokenCount,
        ...getOpenRouterRateLimitPayload(telemetryHeaders),
      },
    });

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
  let streamTelemetryHeaders: Headers | null = response.headers;
  const reader = response.body?.getReader();
  let streamFailure: unknown = null;

  if (!reader) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const durationMs = Date.now() - providerRequestStartedAt;
    const rateLimitPayload = getOpenRouterRateLimitPayload(streamTelemetryHeaders);
    await logEvent({
      type: "AI_REQUEST",
      userId,
      chatId,
      modelId: usedModel,
      payload: {
        source: "web",
        model: usedModel,
        stream: true,
        messageCount: trimmedMessages.length,
        status: 502,
        durationMs,
        error: true,
        ...rateLimitPayload,
      },
    });
    await logEvent({
      type: "AI_ERROR",
      userId,
      chatId,
      modelId: usedModel,
      message: "OpenRouter response stream is missing",
      payload: {
        source: "web",
        durationMs,
        ...rateLimitPayload,
      },
    });
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
          apiKey: openRouterApiKey ?? undefined,
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
      quotaHold = null;
      await logEvent({
        type: "BILLING_ERROR",
        userId,
        chatId,
        modelId: usedModel,
        message,
      });
      return;
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
    });

    if (useCache && assistantText.trim()) {
      const finalCacheKey = buildCacheKey({
        userId,
        model: usedModel,
        messages: trimmedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      });
      await setCachedResponse(finalCacheKey, {
        content: assistantText,
        usage: usage ?? undefined,
        modelId: usedModel,
        createdAt: Date.now(),
      });
    }

    await logEvent({
      type: "AI_REQUEST",
      userId,
      chatId,
      modelId: usedModel,
      payload: {
        source: "web",
        model: usedModel,
        stream: true,
        messageCount: trimmedMessages.length,
        status: 200,
        durationMs: Date.now() - providerRequestStartedAt,
        totalTokens: tokenCount,
        ...getOpenRouterRateLimitPayload(streamTelemetryHeaders),
      },
    });
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
              if (typeof parsed?.model === "string" && parsed.model.trim()) {
                usedModel = parsed.model;
              }
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
            let fallbackResponse: Response | null = null;
            try {
              fallbackResponse = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: requestHeaders,
                body: JSON.stringify(buildOpenRouterChatBody({
                  model: fallback,
                  messages: trimmedMessages,
                  temperature: body.temperature,
                  maxTokens: body.max_tokens,
                  stream: false,
                })),
                timeoutMs: OPENROUTER_CHAT_TIMEOUT_MS,
                timeoutLabel: "OpenRouter chat stream fallback",
              });
            } catch {
              fallbackResponse = null;
            }

            if (fallbackResponse?.ok) {
              const fallbackData = await fallbackResponse.json();
              const fallbackText =
                fallbackData?.choices?.[0]?.message?.content ?? "";
              const fallbackUsage = fallbackData?.usage ?? null;
              if (fallbackText.trim()) {
                usedModel = fallback;
                assistantText = fallbackText;
                usage = fallbackUsage;
                streamTelemetryHeaders = fallbackResponse.headers;
                const payload = JSON.stringify({
                  choices: [{ delta: { content: fallbackText } }],
                });
                controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              }
            }
          }
        }
      } catch (error) {
        streamFailure = error;
      } finally {
        if (streamFailure) {
          const durationMs = Date.now() - providerRequestStartedAt;
          const rateLimitPayload = getOpenRouterRateLimitPayload(streamTelemetryHeaders);
          await releaseAiQuotaHold({ hold: quotaHold });
          quotaHold = null;
          await logEvent({
            type: "AI_REQUEST",
            userId,
            chatId,
            modelId: usedModel,
            payload: {
              source: "web",
              model: usedModel,
              stream: true,
              messageCount: trimmedMessages.length,
              status: isFetchTimeoutError(streamFailure) ? 504 : 502,
              durationMs,
              error: true,
              ...rateLimitPayload,
            },
          });
          await logEvent({
            type: "AI_ERROR",
            userId,
            chatId,
            modelId: usedModel,
            message:
              streamFailure instanceof Error
                ? streamFailure.message
                : "OpenRouter stream interrupted",
            payload: {
              source: "web",
              durationMs,
              ...rateLimitPayload,
            },
          });

          try {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({
                  error: "OpenRouter stream interrupted",
                })}\n\n`
              )
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch {
            // Ignore enqueue errors when the client disconnected early.
          }
        }
        controller.close();
        if (!streamFailure) {
          void finalizeStream();
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: streamHeaders,
  });
}
