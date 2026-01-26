import { NextResponse } from "next/server";
import { z } from "zod";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";
import { trimMessages } from "@/lib/context";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculateCreditsFromUsage } from "@/lib/pricing";
import { spendCredits } from "@/lib/billing";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/telemetry";
import { getUserOpenRouterKey } from "@/lib/user-settings";
import { buildPersonalizationSystemPrompt } from "@/lib/personalization";
import { searchWeb } from "@/lib/search";
import { checkModeration } from "@/lib/moderation";
import { getOrgDlpPolicy, getOrgModelPolicy } from "@/lib/org-settings";
import { evaluateDlp } from "@/lib/dlp";
import { isModelAllowed } from "@/lib/model-policy";
import { logAudit } from "@/lib/audit";
import { findOwnedChat } from "@/lib/chat-ownership";
import {
  buildCacheKey,
  getCachedResponse,
  setCachedResponse,
} from "@/lib/cache";
import { updateChatSummary } from "@/lib/summary";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(true),
  chatId: z.string().optional(),
  contextLength: z.number().int().positive().optional(),
  fallbackModels: z.array(z.string().min(1)).optional(),
  useWebSearch: z.boolean().optional(),
  cache: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = await auth(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const body = requestSchema.parse(await request.json());
  const ownedChat = body.chatId
    ? await findOwnedChat({
        chatId: body.chatId,
        userId: session.user.id,
        select: {
          summary: true,
          attachments: { orderBy: { createdAt: "asc" } },
        },
      })
    : null;
  if (body.chatId && !ownedChat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isModelAllowed(body.model, modelPolicy)) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user.orgId,
      actorId: session.user.id,
      targetType: "model",
      targetId: body.model,
      metadata: { reason: "blocked_by_policy" },
    });
    return NextResponse.json(
      { error: "Модель запрещена политикой организации." },
      { status: 403 }
    );
  }

  const allowedFallbacks = (body.fallbackModels ?? []).filter((modelId) =>
    isModelAllowed(modelId, modelPolicy)
  );

  const personalization = buildPersonalizationSystemPrompt(
    user?.settings ?? null
  );

  const systemMessages: Array<{ role: "system"; content: string }> = [];
  if (personalization) {
    systemMessages.push({ role: "system", content: personalization });
  }

  let attachmentMessages: Array<{ role: "system"; content: string }> = [];
  if (body.chatId) {
    if (ownedChat?.summary?.trim()) {
      systemMessages.push({
        role: "system",
        content: `Контекст диалога:\n${ownedChat.summary}`,
      });
    }

    attachmentMessages = (ownedChat?.attachments ?? [])
      .filter((attachment) => attachment.textContent?.trim())
      .slice(-3)
      .map((attachment) => ({
        role: "system" as const,
        content: [
          `Файл: ${attachment.filename} (${attachment.mimeType})`,
          attachment.textContent.slice(0, 6000),
        ].join("\n"),
      }));
  }

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

  let dlpRedacted = false;
  let dlpBlockedMatches: string[] | null = null;
  const safeMessages = body.messages.map((message) => {
    if (message.role !== "user") return message;
    const outcome = evaluateDlp(message.content, dlpPolicy);
    if (outcome.action === "block") {
      dlpBlockedMatches = outcome.matches;
      return message;
    }
    if (outcome.action === "redact" && outcome.redactedText) {
      dlpRedacted = true;
      return { ...message, content: outcome.redactedText };
    }
    return message;
  });

  if (dlpBlockedMatches) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user.orgId,
      actorId: session.user.id,
      targetType: "dlp",
      targetId: body.chatId ?? null,
      metadata: { matches: dlpBlockedMatches },
    });
    return NextResponse.json(
      { error: "Запрос отклонен политикой DLP." },
      { status: 400 }
    );
  }

  if (dlpRedacted) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user.orgId,
      actorId: session.user.id,
      targetType: "dlp",
      targetId: body.chatId ?? null,
      metadata: { action: "redact" },
    });
  }

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
  const userKey = allowUserKey
    ? getUserOpenRouterKey(user?.settings ?? null)
    : undefined;

  try {
    requestHeaders = getOpenRouterHeaders(userKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing config";
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
        model: body.model,
        messages: trimmedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      })
    : null;

  const cached = cacheKey ? getCachedResponse(cacheKey) : null;
  if (cached) {
    if (body.chatId) {
      let creditsResult = { credits: 0 };
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
        });
      }

      await prisma.message.create({
        data: {
          chatId: body.chatId,
          userId: session.user.id,
          costCenterId: user?.costCenterId ?? undefined,
          role: "ASSISTANT",
          content: cached.content,
          tokenCount: cached.usage?.total_tokens ?? 0,
          cost: creditsResult.credits,
          modelId: cached.modelId,
        },
      });

      await prisma.chat.update({
        where: { id: body.chatId },
        data: { updatedAt: new Date() },
      });
      void updateChatSummary({
        chatId: body.chatId,
        userId: session.user.id,
        apiKey: userKey,
      });
    }

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

  if (!response || !response.ok) {
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

    if (body.chatId) {
      let creditsResult = { credits: 0 };
      const tokenCount = usage?.total_tokens ?? 0;

      if (usage) {
        try {
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
            });
          }
        } catch (error) {
          await logEvent({
            type: "BILLING_ERROR",
            userId: session.user.id,
            chatId: body.chatId,
            modelId: usedModel,
            message: error instanceof Error ? error.message : "Billing error",
          });
        }
      }

      await prisma.message.create({
        data: {
          chatId: body.chatId,
          userId: session.user.id,
          costCenterId: user?.costCenterId ?? undefined,
          role: "ASSISTANT",
          content: assistantContent,
          tokenCount,
          cost: creditsResult.credits,
          modelId: usedModel,
        },
      });

      await prisma.chat.update({
        where: { id: body.chatId },
        data: { updatedAt: new Date() },
      });
    }

    if (useCache) {
      const finalCacheKey = buildCacheKey({
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

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();

      if (!reader) {
        controller.close();
        return;
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

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

        controller.enqueue(encoder.encode(chunk));
      }

      if (!assistantText.trim() && modelsToTry.length > 1) {
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

      if (body.chatId) {
        let creditsResult = { credits: 0 };
        const tokenCount = usage?.total_tokens ?? 0;

        if (usage) {
          try {
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
              });
            }
          } catch (error) {
            await logEvent({
              type: "BILLING_ERROR",
              userId: session.user.id,
              chatId: body.chatId,
              modelId: usedModel,
              message: error instanceof Error ? error.message : "Billing error",
            });
          }
        }

        await prisma.message.create({
          data: {
            chatId: body.chatId,
            userId: session.user.id,
            costCenterId: user?.costCenterId ?? undefined,
            role: "ASSISTANT",
            content: assistantText,
            tokenCount,
            cost: creditsResult.credits,
            modelId: usedModel,
          },
        });

        await prisma.chat.update({
          where: { id: body.chatId },
          data: { updatedAt: new Date() },
        });
        void updateChatSummary({
          chatId: body.chatId,
          userId: session.user.id,
          apiKey: userKey,
        });
      }

      if (useCache && assistantText.trim()) {
        const finalCacheKey = buildCacheKey({
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

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: streamHeaders,
  });
}
