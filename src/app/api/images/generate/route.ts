import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateImageForUser } from "@/lib/image-generation";
import { toImageGenerationErrorResponse } from "@/lib/image-generation-errors";

const generateImageSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  modelId: z.string().trim().min(1).max(200).optional(),
  chatId: z.string().trim().min(1).max(200).optional(),
  aspectRatio: z.string().trim().min(1).max(20).optional(),
  imageSize: z.string().trim().min(1).max(40).optional(),
  costCenterId: z.string().trim().min(1).max(200).optional(),
});

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Invalid request", issues: error.issues },
      { status: 400 }
    );
  }

  const response = toImageGenerationErrorResponse(error);
  return NextResponse.json(response.body, { status: response.status });
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
    const payload = generateImageSchema.parse(await request.json());
    const result = await generateImageForUser({
      userId: session.user.id,
      prompt: payload.prompt,
      modelId: payload.modelId,
      chatId: payload.chatId,
      aspectRatio: payload.aspectRatio ?? null,
      imageSize: payload.imageSize ?? null,
      costCenterId: payload.costCenterId ?? null,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
