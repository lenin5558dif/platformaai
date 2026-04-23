export type ImageGenerationIntent =
  | {
      isImageGeneration: true;
      prompt: string;
    }
  | {
      isImageGeneration: false;
      prompt: string;
    };

const POSITIVE_PATTERNS = [
  /\b(generate|create|make|draw|render)\s+(an?\s+)?(image|picture|photo|illustration|art)\b/i,
  /\b(image|picture|photo|illustration)\s+(of|with|for)\b/i,
  /(?:^|\s)сгенерируй(?:те)?\s+(?:мне\s+)?(?:изображение|картинку|фото|иллюстрацию)(?:\s|$)/i,
  /(?:^|\s)создай(?:те)?\s+(?:мне\s+)?(?:изображение|картинку|фото|иллюстрацию)(?:\s|$)/i,
  /(?:^|\s)нарисуй(?:те)?\s+(?:мне\s+)?\S+/i,
  /(?:^|\s)сделай(?:те)?\s+(?:мне\s+)?(?:изображение|картинку|фото|иллюстрацию)(?:\s|$)/i,
];

const NEGATIVE_PATTERNS = [
  /(?:^|\s)(опиши|проанализируй|объясни|распознай|прочитай)\s+(?:это\s+)?(?:изображение|картинку|фото)(?:\s|$)/i,
  /(?:^|\s)как\s+(?:сгенерировать|создать|нарисовать)(?:\s|$)/i,
  /\bwhat\s+is\s+(?:this\s+)?(image|picture|photo)\b/i,
  /\bdescribe\s+(?:this\s+)?(image|picture|photo)\b/i,
  /\bhow\s+to\s+(generate|create|draw)\b/i,
];

function normalizePrompt(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

export function detectImageGenerationIntent(text: string): ImageGenerationIntent {
  const prompt = normalizePrompt(text);
  if (!prompt) {
    return { isImageGeneration: false, prompt };
  }

  if (NEGATIVE_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return { isImageGeneration: false, prompt };
  }

  const isImageGeneration = POSITIVE_PATTERNS.some((pattern) => pattern.test(prompt));
  return isImageGeneration
    ? { isImageGeneration: true, prompt }
    : { isImageGeneration: false, prompt };
}
