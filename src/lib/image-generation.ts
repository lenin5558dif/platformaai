import { ImageGenerationStatus, type Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { applyDlpToText, validateModelPolicy } from "@/lib/ai-authorization";
import {
  preflightCredits,
  reserveAiQuotaHold,
  commitAiQuotaHold,
  releaseAiQuotaHold,
  spendCredits,
  type AiQuotaHold,
} from "@/lib/billing";
import { mapBillingError } from "@/lib/billing-errors";
import { getBillingTier, isFreeBillingTier } from "@/lib/billing-tiers";
import { findOwnedChat } from "@/lib/chat-ownership";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { generateImageWithOpenRouter } from "@/lib/image-generation-provider";
import { getImageModelById, isFreeImageModel } from "@/lib/image-models";
import { calculateCreditsFromImageModel } from "@/lib/image-pricing";
import { saveGeneratedImageDataUrl } from "@/lib/image-storage";
import { getOrgDlpPolicy, getOrgModelPolicy } from "@/lib/org-settings";
import { getPlatformConfig } from "@/lib/platform-config";
import { resolveOpenRouterApiKey } from "@/lib/provider-credentials";
import { logEvent } from "@/lib/telemetry";

const DEFAULT_IMAGE_MODEL_ID = "black-forest-labs/flux.2-klein-4b";

export type GenerateImageForUserParams = {
  userId: string;
  prompt: string;
  modelId?: string;
  chatId?: string;
  aspectRatio?: string | null;
  imageSize?: string | null;
  costCenterId?: string | null;
};

function getDefaultImageModelId() {
  return process.env.DEFAULT_IMAGE_MODEL_ID ?? DEFAULT_IMAGE_MODEL_ID;
}

function normalizeDisabledModelIds(modelIds: string[]) {
  return new Set(
    modelIds
      .map((modelId) => modelId.trim().toLowerCase())
      .filter(Boolean)
  );
}

function toGenerationDto(generation: {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  modelId: string;
  status: ImageGenerationStatus;
  mimeType: string | null;
  publicUrl: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  imageSize: string | null;
  cost: Prisma.Decimal | number | string;
  tokenCount: number;
  providerRequestId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...generation,
    cost: generation.cost.toString(),
    fileUrl:
      generation.status === ImageGenerationStatus.COMPLETED && generation.mimeType
        ? `/api/images/${generation.id}/file`
        : null,
  };
}

export async function generateImageForUser(params: GenerateImageForUserParams) {
  if (process.env.IMAGE_GENERATION_ENABLED === "0") {
    throw new HttpError(503, "IMAGE_GENERATION_DISABLED", "Генерация изображений временно выключена.");
  }

  const requestedModelId = params.modelId?.trim() || getDefaultImageModelId();
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      balance: true,
      costCenterId: true,
      isActive: true,
      orgId: true,
      settings: true,
      org: { select: { settings: true } },
    },
  });

  if (!user || user.isActive === false) {
    throw new HttpError(404, "USER_NOT_FOUND", "Пользователь не найден.");
  }

  if (params.chatId) {
    const chat = await findOwnedChat({
      chatId: params.chatId,
      userId: params.userId,
      select: { id: true },
    });
    if (!chat) {
      throw new HttpError(404, "CHAT_NOT_FOUND", "Чат не найден.");
    }
  }

  const [platformConfig, openRouterApiKey] = await Promise.all([
    getPlatformConfig(),
    resolveOpenRouterApiKey({ userId: user.id, orgId: user.orgId }),
  ]);

  if (!openRouterApiKey) {
    throw new HttpError(401, "OPENROUTER_KEY_MISSING", "OpenRouter API key is not configured.");
  }

  const disabledModelIds = normalizeDisabledModelIds(platformConfig.disabledModelIds);
  if (disabledModelIds.has(requestedModelId.toLowerCase())) {
    throw new HttpError(403, "MODEL_DISABLED", "Модель временно недоступна.");
  }

  const imageModel = await getImageModelById(requestedModelId, openRouterApiKey);
  if (!imageModel) {
    throw new HttpError(404, "IMAGE_MODEL_NOT_FOUND", "Модель генерации изображений не найдена.");
  }

  const billingTier = getBillingTier(user.settings, user.balance);
  if (isFreeBillingTier(billingTier)) {
    throw new HttpError(
      402,
      "PAID_IMAGE_MODEL_REQUIRED",
      "Генерация изображений доступна только на платном тарифе."
    );
  }

  const audit = {
    orgId: user.orgId ?? null,
    actorId: user.id,
    targetId: params.chatId ?? null,
  };
  const modelPolicy = getOrgModelPolicy(user.org?.settings ?? null);
  const modelValidation = await validateModelPolicy({
    modelId: requestedModelId,
    policy: modelPolicy,
    audit,
  });
  if (!modelValidation.ok) {
    throw new HttpError(modelValidation.status, "MODEL_POLICY_BLOCKED", modelValidation.error);
  }

  const dlpPolicy = getOrgDlpPolicy(user.org?.settings ?? null);
  const dlpResult = await applyDlpToText({
    text: params.prompt,
    policy: dlpPolicy,
    audit,
  });
  if (!dlpResult.ok) {
    throw new HttpError(dlpResult.status, "DLP_BLOCKED", dlpResult.error);
  }

  const prompt = dlpResult.content ?? params.prompt;
  const pricing = calculateCreditsFromImageModel(imageModel);
  const cost = isFreeImageModel(imageModel) ? 0 : pricing.credits;
  const reserveAmount = cost > 0 ? Math.max(1, Math.ceil(cost)) : 0;
  const costCenterId = params.costCenterId ?? user.costCenterId ?? undefined;
  const idempotencyKey = crypto.randomUUID();
  let quotaHold: AiQuotaHold | null = null;
  let generationId: string | null = null;

  if (reserveAmount > 0) {
    quotaHold = await reserveAiQuotaHold({
      userId: user.id,
      amount: reserveAmount,
      idempotencyKey,
      costCenterId,
    });
    if (!quotaHold) {
      await preflightCredits({ userId: user.id, minAmount: reserveAmount });
    }
  }

  try {
    const generation = await prisma.imageGeneration.create({
      data: {
        userId: user.id,
        chatId: params.chatId ?? null,
        prompt,
        modelId: imageModel.id,
        status: ImageGenerationStatus.PENDING,
        aspectRatio: params.aspectRatio ?? null,
        imageSize: params.imageSize ?? null,
        cost: 0,
        metadata: {
          requestedModelId,
          billingTier,
          pricing,
          redacted: dlpResult.redacted,
        },
      },
    });
    generationId = generation.id;

    const providerResult = await generateImageWithOpenRouter({
      apiKey: openRouterApiKey,
      modelId: imageModel.id,
      prompt,
      outputModalities: imageModel.output_modalities,
      aspectRatio: params.aspectRatio ?? null,
      imageSize: params.imageSize ?? null,
    });

    const stored = await saveGeneratedImageDataUrl({
      dataUrl: providerResult.images[0].dataUrl,
      userId: user.id,
      generationId: generation.id,
    });

    if (cost > 0) {
      await spendCredits({
        userId: user.id,
        amount: cost,
        description: `OpenRouter image ${imageModel.id}`,
        costCenterId,
      });
    }
    await commitAiQuotaHold({ hold: quotaHold, finalAmount: cost });
    quotaHold = null;

    const completed = await prisma.imageGeneration.update({
      where: { id: generation.id },
      data: {
        status: ImageGenerationStatus.COMPLETED,
        mimeType: stored.mimeType,
        storagePath: stored.storagePath,
        revisedPrompt: providerResult.content || null,
        cost,
        providerRequestId: providerResult.id ?? null,
        metadata: {
          requestedModelId,
          billingTier,
          pricing,
          redacted: dlpResult.redacted,
          storageSize: stored.size,
          providerImageIndex: providerResult.images[0].index,
        },
      },
    });

    await logEvent({
      type: "AI_REQUEST",
      userId: user.id,
      chatId: params.chatId ?? null,
      modelId: imageModel.id,
      payload: {
        source: "image-generation",
        status: "completed",
        generationId: completed.id,
        cost,
        aspectRatio: params.aspectRatio ?? null,
        imageSize: params.imageSize ?? null,
      },
    });

    return { data: toGenerationDto(completed) };
  } catch (error) {
    await releaseAiQuotaHold({ hold: quotaHold });
    const message = error instanceof Error ? error.message : "Image generation failed";

    if (generationId) {
      await prisma.imageGeneration.update({
        where: { id: generationId },
        data: {
          status: ImageGenerationStatus.FAILED,
          error: message.slice(0, 1000),
        },
      }).catch(() => null);
    }

    await logEvent({
      type: "AI_ERROR",
      userId: user.id,
      chatId: params.chatId ?? null,
      modelId: requestedModelId,
      message,
      payload: {
        source: "image-generation",
        generationId,
      },
    });

    if (error instanceof HttpError) throw error;
    const billing = mapBillingError(message);
    if (billing.status !== 500 || message === "USER_NOT_FOUND") {
      throw new HttpError(billing.status, "BILLING_ERROR", billing.error);
    }
    throw new HttpError(502, "IMAGE_GENERATION_FAILED", message);
  }
}
