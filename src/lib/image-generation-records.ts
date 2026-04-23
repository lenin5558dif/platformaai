import type { ImageGenerationStatus, Prisma } from "@prisma/client";

export type ImageGenerationRecord = {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  modelId: string;
  status: ImageGenerationStatus;
  mimeType: string | null;
  publicUrl: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  imageSize: string | null;
  cost: Prisma.Decimal | number | string;
  tokenCount: number;
  providerRequestId: string | null;
  error: string | null;
  chatId?: string | null;
  messageId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeImageGeneration(record: ImageGenerationRecord) {
  return {
    ...record,
    cost: record.cost.toString(),
    fileUrl:
      record.status === "COMPLETED" && record.mimeType
        ? `/api/images/${record.id}/file`
        : null,
  };
}
