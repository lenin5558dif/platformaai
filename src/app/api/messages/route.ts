import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgDlpPolicy } from "@/lib/org-settings";
import { evaluateDlp } from "@/lib/dlp";
import { logAudit } from "@/lib/audit";

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
  const org = userProfile?.orgId
    ? await prisma.organization.findUnique({
        where: { id: userProfile.orgId },
        select: { settings: true },
      })
    : null;
  const dlpPolicy = getOrgDlpPolicy(org?.settings ?? null);
  let content = payload.content;

  if (payload.role === "USER") {
    const outcome = evaluateDlp(content, dlpPolicy);
    if (outcome.action === "block") {
      await logAudit({
        action: "POLICY_BLOCKED",
        orgId: userProfile?.orgId ?? null,
        actorId: session.user.id,
        targetType: "dlp",
        targetId: payload.chatId,
        metadata: { matches: outcome.matches },
      });
      return NextResponse.json(
        { error: "Сообщение отклонено политикой DLP." },
        { status: 400 }
      );
    }
    if (outcome.action === "redact" && outcome.redactedText) {
      content = outcome.redactedText;
      await logAudit({
        action: "POLICY_BLOCKED",
        orgId: userProfile?.orgId ?? null,
        actorId: session.user.id,
        targetType: "dlp",
        targetId: payload.chatId,
        metadata: { action: "redact" },
      });
    }
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
      costCenterId: userProfile?.costCenterId ?? undefined,
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
