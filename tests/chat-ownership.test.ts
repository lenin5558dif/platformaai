import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { findOwnedChat } from "../src/lib/chat-ownership";

const mockClient = {
  chat: {
    findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
      if (where.id === "chat-owned" && where.userId === "user-1") {
        return { id: where.id, summary: "ok", attachments: [] };
      }
      return null;
    },
  },
} as unknown as PrismaClient;

test("rejects foreign chatId for /api/ai/chat", async () => {
  const result = await findOwnedChat({
    chatId: "chat-other",
    userId: "user-1",
    select: { summary: true, attachments: { orderBy: { createdAt: "asc" } } },
    client: mockClient,
  });

  assert.equal(result, null);
});

test("rejects foreign chatId for /api/ai/image", async () => {
  const result = await findOwnedChat({
    chatId: "chat-other",
    userId: "user-1",
    select: { id: true },
    client: mockClient,
  });

  assert.equal(result, null);
});
