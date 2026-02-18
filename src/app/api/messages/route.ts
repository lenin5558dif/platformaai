import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgDlpPolicy } from "@/lib/org-settings";
import { applyDlpToText } from "@/lib/ai-authorization";
import {
  preflightCredits,
  reserveAiQuotaHold,
  commitAiQuotaHold,
  releaseAiQuotaHold,
  spendCredits,
} from "@/lib/billing";
import { mapBillingError } from "@/lib/billing-errors";
import { logEvent } from "@/lib/telemetry";

const createSchema = z.object({
  chatId: z.string().min(1),
  role: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
  content: z.string().min(1),
  tokenCount: z.number().int().nonnegative(),
  cost: z.number().nonnegative().optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = createSchema.parse(await request.json());
  const idempotencyKey = crypto.randomUUID();
  const userProfile = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { costCenterId: true, orgId: true },
  });

  let costCenterId: string | undefined = userProfile?.costCenterId ?? undefined;
  if (userProfile?.orgId) {
    const membership = await prisma.orgMembership.findUnique({
      where: {
        orgId_userId: {
          orgId: userProfile.orgId,
          userId: session.user.id,
        },
      },
      select: { id: true, defaultCostCenterId: true },
    });

    const candidate = membership?.defaultCostCenterId ?? userProfile.costCenterId ?? null;
    if (candidate && membership) {
      // Check allowed set
      const allowedCount = await prisma.orgMembershipAllowedCostCenter.count({
        where: { membershipId: membership.id },
      });
      if (allowedCount > 0) {
        const allowed = await prisma.orgMembershipAllowedCostCenter.findUnique({
          where: {
            membershipId_costCenterId: {
              membershipId: membership.id,
              costCenterId: candidate,
            },
          },
          select: { id: true },
        });
        if (!allowed) {
          costCenterId = undefined;
        } else {
          const exists = await prisma.costCenter.findFirst({
            where: { id: candidate, orgId: userProfile.orgId },
            select: { id: true },
          });
          costCenterId = exists ? candidate : undefined;
        }
      } else {
        const exists = await prisma.costCenter.findFirst({
          where: { id: candidate, orgId: userProfile.orgId },
          select: { id: true },
        });
        costCenterId = exists ? candidate : undefined;
      }
    } else {
      costCenterId = undefined;
    }
  }
  const org = userProfile?.orgId
    ? await prisma.organization.findUnique({
        where: { id: userProfile.orgId },
        select: { settings: true },
      })
    : null;
  const dlpPolicy = getOrgDlpPolicy(org?.settings ?? null);
  let content = payload.content;

  if (payload.role === "USER") {
    const dlpResult = await applyDlpToText({
      text: payload.content,
      policy: dlpPolicy,
      audit: {
        orgId: userProfile?.orgId ?? null,
        actorId: session.user.id,
        targetId: payload.chatId,
      },
    });

    if (!dlpResult.ok) {
      return NextResponse.json(
        { error: dlpResult.error },
        { status: dlpResult.status }
      );
    }

    content = dlpResult.content ?? payload.content;
  }
  const chat = await prisma.chat.findFirst({
    where: {
      id: payload.chatId,
      userId: session.user.id,
    },
  });

  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  // Quota reservation for messages with cost
  const finalCost = payload.cost ?? 0;
  let quotaHold = null;

  if (finalCost > 0) {
    const minAmount = 1; // Upper bound estimate - use minAmount as specified

    try {
      quotaHold = await reserveAiQuotaHold({
        userId: session.user.id,
        amount: minAmount,
        idempotencyKey,
        costCenterId,
      });

      if (!quotaHold) {
        await preflightCredits({
          userId: session.user.id,
          minAmount,
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

    try {
      await spendCredits({
        userId: session.user.id,
        amount: finalCost,
        description: "Telegram message",
        costCenterId,
      });

      await commitAiQuotaHold({ hold: quotaHold, finalAmount: finalCost });
      quotaHold = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Billing error";
      await releaseAiQuotaHold({ hold: quotaHold });
      await logEvent({
        type: "BILLING_ERROR",
        userId: session.user.id,
        chatId: payload.chatId,
        message,
      });
      const mapped = mapBillingError(message);
      if (mapped) {
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      return NextResponse.json({ error: "Billing error" }, { status: 500 });
    }
  }

  const message = await prisma.message.create({
    data: {
      chatId: payload.chatId,
      userId: session.user.id,
      costCenterId,
      role: payload.role,
      content,
      tokenCount: payload.tokenCount,
      cost: payload.cost ?? 0,
      modelId: chat.modelId,
    },
  });

  return NextResponse.json(
    {
      data: {
        ...message,
        cost: message.cost.toString(),
      },
    },
    { status: 201 }
  );
}
