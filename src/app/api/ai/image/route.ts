import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";
import { getUserOpenRouterKey } from "@/lib/user-settings";
import { calculateCreditsFromUsage } from "@/lib/pricing";
import { preflightCredits, spendCredits } from "@/lib/billing";
import { mapBillingError } from "@/lib/billing-errors";
import { getOrgModelPolicy } from "@/lib/org-settings";
import { isModelAllowed } from "@/lib/model-policy";
import { logAudit } from "@/lib/audit";
import { findOwnedChat } from "@/lib/chat-ownership";
import { resolveOrgCostCenterId } from "@/lib/cost-centers";
import { HttpError } from "@/lib/authorize";

const requestSchema = z.object({
  attachmentId: z.string().min(1),
  chatId: z.string().optional(),
  prompt: z.string().optional(),
  costCenterId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const session = await auth(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const allowUserKey =
    process.env.AUTH_BYPASS === "1" ||
    process.env.ALLOW_USER_OPENROUTER_KEYS === "1";

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
      select: { defaultCostCenterId: true },
    });

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      costCenterId = await resolveOrgCostCenterId({
        orgId: user.orgId,
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

  const modelId = "openai/gpt-4o-mini";
  const modelPolicy = getOrgModelPolicy(user?.org?.settings ?? null);
  if (!isModelAllowed(modelId, modelPolicy)) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user?.orgId ?? null,
      actorId: session.user.id,
      targetType: "model",
      targetId: modelId,
      metadata: { reason: "blocked_by_policy" },
    });
    return NextResponse.json(
      { error: "Модель запрещена политикой организации." },
      { status: 403 }
    );
  }

  const userKey = allowUserKey
    ? getUserOpenRouterKey(user?.settings ?? null)
    : undefined;

  let headers: Record<string, string>;
  try {
    headers = getOpenRouterHeaders(userKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing config";
    const status = message.includes("OPENROUTER_API_KEY") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    await preflightCredits({ userId: session.user.id, minAmount: 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BILLING_ERROR";
    const mapped = mapBillingError(message);
    if (mapped) {
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    return NextResponse.json({ error: "Billing error" }, { status: 500 });
  }

  const buffer = await readFile(attachment.storagePath);
  const base64 = buffer.toString("base64");
  const imageUrl = `data:${attachment.mimeType};base64,${base64}`;
  const prompt =
    body.prompt ?? "Опиши изображение кратко и по делу на русском языке.";

  const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: "OpenRouter error", details: await response.text() },
      { status: response.status }
    );
  }

  const data = await response.json();
  const description = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage;

  let creditsResult = { credits: 0 };
  if (usage) {
    creditsResult = await calculateCreditsFromUsage({
      modelId,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      apiKey: userKey,
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

  return NextResponse.json({ data: { description } });
}
