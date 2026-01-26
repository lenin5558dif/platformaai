import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type FindOwnedChatParams<TSelect extends Prisma.ChatSelect> = {
  chatId: string;
  userId: string;
  select: TSelect;
  client?: PrismaClient;
};

export async function findOwnedChat<TSelect extends Prisma.ChatSelect>({
  chatId,
  userId,
  select,
  client = prisma,
}: FindOwnedChatParams<TSelect>): Promise<
  Prisma.ChatGetPayload<{ select: TSelect }> | null
> {
  return client.chat.findFirst({
    where: { id: chatId, userId },
    select,
  });
}
