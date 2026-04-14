import { prisma } from "@/lib/db";
import type { EventType, Prisma } from "@prisma/client";

export async function logEvent(params: {
  type: EventType;
  message?: string;
  userId?: string | null;
  chatId?: string | null;
  modelId?: string | null;
  payload?: Prisma.InputJsonValue;
}) {
  const enabled = process.env.LOG_EVENTS !== "0";
  if (!enabled) return;

  try {
    await prisma.eventLog.create({
      data: {
        type: params.type,
        message: params.message,
        userId: params.userId ?? undefined,
        chatId: params.chatId ?? undefined,
        modelId: params.modelId ?? undefined,
        payload: params.payload ?? undefined,
      },
    });
  } catch {
    // Ignore logging errors to avoid cascading failures.
  }
}
