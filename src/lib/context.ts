export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const DEFAULT_CONTEXT_TOKENS = 8000;

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function trimMessages(
  messages: ChatMessage[],
  maxTokens: number = DEFAULT_CONTEXT_TOKENS
) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const dialogue = messages.filter((message) => message.role !== "system");

  let total = 0;
  const trimmed: ChatMessage[] = [];

  for (let i = dialogue.length - 1; i >= 0; i -= 1) {
    const message = dialogue[i];
    const tokens = estimateTokens(message.content);

    if (total + tokens > maxTokens) {
      break;
    }

    trimmed.unshift(message);
    total += tokens;
  }

  return [...systemMessages, ...trimmed];
}
