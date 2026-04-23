export const GENERATED_IMAGE_MESSAGE_PREFIX = "__PLATFORMAAI_IMAGE__:";

export type ChatGeneratedImagePayload = {
  imageGenerationId: string;
  prompt: string;
  modelId: string;
  fileUrl: string | null;
  cost: string;
};

export function serializeGeneratedImageMessage(payload: ChatGeneratedImagePayload) {
  return `${GENERATED_IMAGE_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

export function parseGeneratedImageMessage(content: string): ChatGeneratedImagePayload | null {
  if (!content.startsWith(GENERATED_IMAGE_MESSAGE_PREFIX)) return null;

  try {
    const parsed = JSON.parse(content.slice(GENERATED_IMAGE_MESSAGE_PREFIX.length));
    if (
      typeof parsed?.imageGenerationId !== "string" ||
      typeof parsed?.prompt !== "string" ||
      typeof parsed?.modelId !== "string" ||
      typeof parsed?.cost !== "string"
    ) {
      return null;
    }

    return {
      imageGenerationId: parsed.imageGenerationId,
      prompt: parsed.prompt,
      modelId: parsed.modelId,
      fileUrl: typeof parsed.fileUrl === "string" ? parsed.fileUrl : null,
      cost: parsed.cost,
    };
  } catch {
    return null;
  }
}
