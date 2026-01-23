import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgModelPolicy } from "@/lib/org-settings";
import { isModelAllowed } from "@/lib/model-policy";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  title: z.string().min(1),
  modelId: z.string().min(1),
});

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();

  const where = query
    ? {
        userId: session.user.id,
        OR: [
          { title: { contains: query, mode: "insensitive" as const } },
          {
            messages: {
              some: {
                content: { contains: query, mode: "insensitive" as const },
              },
            },
          },
        ],
      }
    : { userId: session.user.id };

  const chats = await prisma.chat.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ data: chats });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = createSchema.parse(await request.json());
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { org: { select: { settings: true } }, orgId: true },
  });
  const modelPolicy = getOrgModelPolicy(user?.org?.settings ?? null);
  if (!isModelAllowed(payload.modelId, modelPolicy)) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: user?.orgId ?? null,
      actorId: session.user.id,
      targetType: "model",
      targetId: payload.modelId,
      metadata: { reason: "blocked_by_policy" },
    });
    return NextResponse.json(
      { error: "Модель запрещена политикой организации." },
      { status: 403 }
    );
  }

  const chat = await prisma.chat.create({
    data: {
      userId: session.user.id,
      title: payload.title,
      modelId: payload.modelId,
      source: "WEB",
    },
  });

  return NextResponse.json({ data: chat }, { status: 201 });
}
