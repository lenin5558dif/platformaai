import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
});

export const requestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(true),
  chatId: z.string().min(1),
  contextLength: z.number().int().positive().optional(),
  fallbackModels: z.array(z.string().min(1)).optional(),
  useWebSearch: z.boolean().optional(),
  cache: z.boolean().optional(),
});
