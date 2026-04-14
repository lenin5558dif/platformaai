import type { Prisma } from "@prisma/client";
import {
  getUserAssistantInstructions,
  getUserGoal,
  getUserProfile,
  getUserTone,
} from "@/lib/user-settings";

export function buildPersonalizationSystemPrompt(
  settings: Prisma.JsonValue
) {
  const parts: string[] = [];
  const profile = getUserProfile(settings);
  const goal = getUserGoal(settings);
  const tone = getUserTone(settings);
  const instructions = getUserAssistantInstructions(settings);

  if (profile) {
    parts.push(`Профиль пользователя: ${profile}`);
  }
  if (goal) {
    parts.push(`Цель пользователя: ${goal}`);
  }
  if (tone) {
    parts.push(`Желаемый тон ответа: ${tone}`);
  }
  if (instructions) {
    parts.push(`Дополнительные инструкции ассистенту: ${instructions}`);
  }

  if (!parts.length) return null;

  return [
    "Следуй персональным настройкам пользователя.",
    ...parts,
  ].join("\n");
}
