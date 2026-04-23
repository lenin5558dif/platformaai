import { describe, expect, test } from "vitest";
import { detectImageGenerationIntent } from "../src/lib/image-intent";

describe("image intent detection", () => {
  test.each([
    "Сгенерируй изображение космической кофейни",
    "создай картинку кота в стиле постера",
    "Нарисуй робота на велосипеде",
    "generate image of a neon city",
    "make a picture with mountains",
  ])("detects image generation command: %s", (input) => {
    expect(detectImageGenerationIntent(input)).toMatchObject({
      isImageGeneration: true,
    });
  });

  test.each([
    "Опиши изображение, которое я загрузил",
    "как сгенерировать изображение в сервисе?",
    "Мне нравится эта картинка, что скажешь?",
    "describe this image",
    "how to create image prompts",
  ])("does not steal non-generation request: %s", (input) => {
    expect(detectImageGenerationIntent(input)).toMatchObject({
      isImageGeneration: false,
    });
  });

  test("normalizes prompt whitespace", () => {
    expect(detectImageGenerationIntent("  сгенерируй   изображение   леса  ")).toEqual({
      isImageGeneration: true,
      prompt: "сгенерируй изображение леса",
    });
  });
});
