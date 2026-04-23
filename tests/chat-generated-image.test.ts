import { describe, expect, test } from "vitest";
import {
  parseGeneratedImageMessage,
  serializeGeneratedImageMessage,
} from "../src/lib/chat-generated-image";

describe("chat generated image messages", () => {
  test("serializes and parses generated image payload", () => {
    const payload = {
      imageGenerationId: "gen_1",
      prompt: "Нарисуй город",
      modelId: "image/free",
      fileUrl: "/api/images/gen_1/file",
      cost: "0",
    };

    expect(parseGeneratedImageMessage(serializeGeneratedImageMessage(payload))).toEqual(payload);
  });

  test("returns null for normal text messages", () => {
    expect(parseGeneratedImageMessage("Привет")).toBeNull();
  });
});
