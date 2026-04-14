import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const updateSchema = z.object({
  content: z.string().min(1),
  rollback: z.boolean().optional(),
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

  const message = await prisma.message.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = updateSchema.parse(await request.json());

  const updated = await prisma.message.update({
    where: { id },
    data: { content: payload.content },
  });

  if (payload.rollback) {
    await prisma.message.deleteMany({
      where: {
        chatId: message.chatId,
        userId: session.user.id,
        createdAt: { gt: message.createdAt },
      },
    });
  }

  return NextResponse.json({
    data: {
      ...updated,
      cost: updated.cost.toString(),
    },
  });
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

  await prisma.message.deleteMany({
    where: { id, userId: session.user.id },
  });

  return NextResponse.json({ success: true });
}
