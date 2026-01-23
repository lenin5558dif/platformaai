import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chat = await prisma.chat.findFirst({
    where: {
      id,
      userId: session.user.id,
    },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!chat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const serialized = {
    ...chat,
    messages: chat.messages.map((message) => ({
      ...message,
      cost: message.cost.toString(),
    })),
    attachments: chat.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      hasText: Boolean(attachment.textContent),
    })),
  };

  return NextResponse.json({ data: serialized });
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  pinned: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = updateSchema.parse(await request.json());

  const chat = await prisma.chat.updateMany({
    where: { id, userId: session.user.id },
    data: payload,
  });

  if (chat.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.$transaction([
    prisma.message.deleteMany({
      where: { chatId: id, userId: session.user.id },
    }),
    prisma.chat.deleteMany({ where: { id, userId: session.user.id } }),
  ]);

  return NextResponse.json({ success: true });
}
