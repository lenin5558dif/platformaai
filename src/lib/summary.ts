import { prisma } from "@/lib/db";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";

type SummaryParams = {
  chatId: string;
  userId: string;
  apiKey?: string;
};

export async function updateChatSummary(params: SummaryParams) {
  if (process.env.ENABLE_CHAT_SUMMARY !== "1") {
    return;
  }

  const chat = await prisma.chat.findFirst({
    where: { id: params.chatId, userId: params.userId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!chat || chat.messages.length < 12) {
    return;
  }

  const messagesToSummarize = chat.messages
    .slice(0, -6)
    .filter((message) => message.role !== "SYSTEM")
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(0, 12000);

  if (!messagesToSummarize.trim()) return;

  const headers = getOpenRouterHeaders(params.apiKey);
  const response = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Сделай краткое резюме диалога, сохрани ключевые факты, решения и договоренности. Без лишних деталей.",
        },
        { role: "user", content: messagesToSummarize },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    return;
  }

  const data = await response.json();
  const summary = data?.choices?.[0]?.message?.content ?? "";

  if (!summary.trim()) return;

  await prisma.chat.update({
    where: { id: chat.id },
    data: { summary },
  });
}
