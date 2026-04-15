import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";
import { calculateCreditsFromUsage } from "@/lib/pricing";
import {
  commitAiQuotaHold,
  preflightCredits,
  releaseAiQuotaHold,
  reserveAiQuotaHold,
  spendCredits,
} from "@/lib/billing";
import { mapBillingError } from "@/lib/billing-errors";
import { estimateTokensFromText, estimateUpperBoundCredits } from "@/lib/quota-estimation";
import { getOrgModelPolicy, getOrgDlpPolicy } from "@/lib/org-settings";
import {
  validateModelPolicy,
  applyDlpToText,
} from "@/lib/ai-authorization";
import { findOwnedChat } from "@/lib/chat-ownership";
import { resolveOrgCostCenterId } from "@/lib/cost-centers";
import { HttpError } from "@/lib/http-error";
import { fetchWithTimeout, isFetchTimeoutError } from "@/lib/fetch-timeout";
import { logEvent } from "@/lib/telemetry";
import { getPlatformConfig } from "@/lib/platform-config";
import { resolveOpenRouterApiKey } from "@/lib/provider-credentials";
import { getOpenRouterRateLimitPayload } from "@/lib/openrouter-metrics";

const OPENROUTER_IMAGE_TIMEOUT_MS = 45_000;

const requestSchema = z.object({
  attachmentId: z.string().min(1),
  chatId: z.string().optional(),
  prompt: z.string().optional(),
  costCenterId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Сессия истекла. Войдите снова.", code: "AUTH_UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const body = requestSchema.parse(await request.json());
  const attachment = await prisma.attachment.findFirst({
    where: { id: body.attachmentId, userId: session.user.id },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!attachment.mimeType.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }

  const ownedChat = body.chatId
    ? await findOwnedChat({
        chatId: body.chatId,
        userId: session.user.id,
        select: { id: true },
      })
    : null;
  if (body.chatId && !ownedChat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      balance: true,
      settings: true,
      org: { select: { settings: true } },
      orgId: true,
      costCenterId: true,
    },
  });

  if (!user || Number(user.balance) <= 0) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 402 });
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
      select: { id: true, defaultCostCenterId: true },
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

  const [platformConfig, openRouterApiKey] = await Promise.all([
    getPlatformConfig(),
    resolveOpenRouterApiKey({ userId: user.id, orgId: user.orgId }),
  ]);

  const modelId = "openai/gpt-4o-mini";
  const modelPolicy = getOrgModelPolicy(user?.org?.settings ?? null);
  const dlpPolicy = getOrgDlpPolicy(user?.org?.settings ?? null);
  const disabledModels = new Set(
    platformConfig.disabledModelIds
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );

  const modelValidation = await validateModelPolicy({
    modelId,
    policy: modelPolicy,
    audit: {
      orgId: user?.orgId ?? null,
      actorId: session.user.id,
      targetId: modelId,
    },
  });

  if (!modelValidation.ok) {
    return NextResponse.json(
      { error: modelValidation.error },
      { status: modelValidation.status }
    );
  }

  if (disabledModels.has(modelId.toLowerCase())) {
    return NextResponse.json(
      { error: "Модель временно отключена администратором платформы." },
      { status: 403 }
    );
  }

  const prompt =
    body.prompt ?? "Опиши изображение кратко и по делу на русском языке.";

  // Apply DLP to prompt before external AI call
  const dlpResult = await applyDlpToText({
    text: prompt,
    policy: dlpPolicy,
    audit: {
      orgId: user?.orgId ?? null,
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

  const safePrompt = dlpResult.content ?? prompt;
  const finalPrompt = platformConfig.globalSystemPrompt?.trim()
    ? `${platformConfig.globalSystemPrompt.trim()}\n\n${safePrompt}`
    : safePrompt;

  const idempotencyKey = crypto.randomUUID();
  let quotaHold = null;

  try {
    const promptTokensEstimate = estimateTokensFromText(finalPrompt);
    const estimatedCredits = await estimateUpperBoundCredits({
      modelId,
      promptTokensEstimate,
      apiKey: openRouterApiKey ?? undefined,
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

  let headers: Record<string, string>;
  if (!openRouterApiKey) {
    await releaseAiQuotaHold({ hold: quotaHold });
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId ?? null,
      modelId,
      message: "OPENROUTER_API_KEY is not set",
      payload: {
        source: "image",
        orgId: user.orgId ?? null,
      },
    });
    return NextResponse.json(
      { error: "OpenRouter API key is not configured" },
      { status: 401 }
    );
  }
  try {
    headers = getOpenRouterHeaders(openRouterApiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing config";
    await releaseAiQuotaHold({ hold: quotaHold });
    const status = message.includes("OPENROUTER_API_KEY") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const buffer = await readFile(attachment.storagePath);
  const base64 = buffer.toString("base64");
  const imageUrl = `data:${attachment.mimeType};base64,${base64}`;
  const providerRequestStartedAt = Date.now();

  let response: Response;
  try {
    response = await fetchWithTimeout(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: finalPrompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        stream: false,
      }),
      timeoutMs: OPENROUTER_IMAGE_TIMEOUT_MS,
      timeoutLabel: "OpenRouter image description",
    });
  } catch (error) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const message = isFetchTimeoutError(error) ? "OpenRouter timeout" : "OpenRouter error";
    const status = isFetchTimeoutError(error) ? 504 : 502;
    const durationMs = Date.now() - providerRequestStartedAt;
    await logEvent({
      type: "AI_REQUEST",
      userId: session.user.id,
      chatId: body.chatId ?? null,
      modelId,
      payload: {
        source: "image",
        model: modelId,
        status,
        durationMs,
        error: true,
      },
    });
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId ?? null,
      modelId,
      message,
      payload: {
        source: "image",
        durationMs,
      },
    });
    return NextResponse.json({ error: message }, { status });
  }

  if (!response.ok) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const status = response.status;
    const durationMs = Date.now() - providerRequestStartedAt;
    const rateLimitPayload = getOpenRouterRateLimitPayload(response.headers);
    const details = await response.text();
    await logEvent({
      type: "AI_REQUEST",
      userId: session.user.id,
      chatId: body.chatId ?? null,
      modelId,
      payload: {
        source: "image",
        model: modelId,
        status,
        durationMs,
        error: true,
        ...rateLimitPayload,
      },
    });
    await logEvent({
      type: "AI_ERROR",
      userId: session.user.id,
      chatId: body.chatId ?? null,
      modelId,
      payload: {
        source: "image",
        status,
        durationMs,
        details: details.slice(0, 500),
        ...rateLimitPayload,
      },
    });
    return NextResponse.json(
      { error: "OpenRouter error", details },
      { status }
    );
  }

  const data = await response.json();
  const description = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage;

  let creditsResult = { credits: 0 };
  try {
    if (usage) {
      creditsResult = await calculateCreditsFromUsage({
        modelId,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        apiKey: openRouterApiKey ?? undefined,
      });

      if (creditsResult.credits > 0) {
        await spendCredits({
          userId: session.user.id,
          amount: creditsResult.credits,
          description: "OpenRouter image description",
          costCenterId,
        });
      }
    }

    await commitAiQuotaHold({ hold: quotaHold, finalAmount: creditsResult.credits });
    quotaHold = null;
  } catch (error) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const message = error instanceof Error ? error.message : "Billing error";
    const mapped = mapBillingError(message);
    if (mapped) {
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }
    return NextResponse.json({ error: "Billing error" }, { status: 500 });
  }

  if (body.chatId && description.trim()) {
    await prisma.message.create({
      data: {
        chatId: body.chatId,
        userId: session.user.id,
        costCenterId,
        role: "ASSISTANT",
        content: `Описание изображения: ${description}`,
        tokenCount: usage?.total_tokens ?? 0,
        cost: creditsResult.credits,
        modelId,
      },
    });
    await prisma.chat.update({
      where: { id: body.chatId },
      data: { updatedAt: new Date() },
    });
  }

  await logEvent({
    type: "AI_REQUEST",
    userId: session.user.id,
    chatId: body.chatId ?? null,
    modelId,
    payload: {
      source: "image",
      model: modelId,
      status: 200,
      durationMs: Date.now() - providerRequestStartedAt,
      totalTokens: usage?.total_tokens ?? 0,
      ...getOpenRouterRateLimitPayload(response.headers),
    },
  });

  return NextResponse.json({ data: { description } });
}
