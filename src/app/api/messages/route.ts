import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgDlpPolicy } from "@/lib/org-settings";
import { applyDlpToText } from "@/lib/ai-authorization";

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
      select: { defaultCostCenterId: true },
    });

    const candidate = membership?.defaultCostCenterId ?? userProfile.costCenterId ?? null;
    if (candidate) {
      const exists = await prisma.costCenter.findFirst({
        where: { id: candidate, orgId: userProfile.orgId },
        select: { id: true },
      });
      costCenterId = exists ? candidate : undefined;
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
