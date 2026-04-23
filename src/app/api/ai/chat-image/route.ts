import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { findOwnedChat } from "@/lib/chat-ownership";
import { serializeGeneratedImageMessage } from "@/lib/chat-generated-image";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { generateImageForUser } from "@/lib/image-generation";

const chatImageSchema = z.object({
  chatId: z.string().trim().min(1),
  prompt: z.string().trim().min(3).max(4000),
  modelId: z.string().trim().min(1).max(200).optional(),
  aspectRatio: z.string().trim().min(1).max(20).optional(),
  imageSize: z.string().trim().min(1).max(40).optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }

  const message = error instanceof Error ? error.message : "Image generation error";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_UNAUTHORIZED" },
      { status: 401 }
    );
  }

  try {
    const payload = chatImageSchema.parse(await request.json());
    const chat = await findOwnedChat({
      chatId: payload.chatId,
      userId: session.user.id,
      select: { id: true, modelId: true },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const userMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        userId: session.user.id,
        role: "USER",
        content: payload.prompt,
        tokenCount: 0,
        cost: 0,
        modelId: chat.modelId,
      },
    });

    const generationResult = await generateImageForUser({
      userId: session.user.id,
      prompt: payload.prompt,
      chatId: chat.id,
      modelId: payload.modelId,
      aspectRatio: payload.aspectRatio ?? null,
      imageSize: payload.imageSize ?? null,
    });
    const generation = generationResult.data;

    const assistantMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        userId: session.user.id,
        role: "ASSISTANT",
        content: serializeGeneratedImageMessage({
          imageGenerationId: generation.id,
          prompt: generation.prompt,
          modelId: generation.modelId,
          fileUrl: generation.fileUrl,
          cost: generation.cost,
        }),
        tokenCount: 0,
        cost: generation.cost,
        modelId: generation.modelId,
      },
    });

    await Promise.all([
      prisma.imageGeneration.update({
        where: { id: generation.id },
        data: { messageId: assistantMessage.id },
      }),
      prisma.chat.update({
        where: { id: chat.id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return NextResponse.json(
      {
        data: {
          userMessage,
          assistantMessage,
          generation,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
