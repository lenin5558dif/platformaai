import { describe, expect, test } from "vitest";
import { calculateCreditsFromImageModel } from "../src/lib/image-pricing";

describe("image pricing", () => {
  test("uses image pricing with product markup", () => {
    const result = calculateCreditsFromImageModel({
      pricing: { image: "0.02", prompt: "0", completion: "0" },
    });

    expect(result.totalUsd).toBe(0.04);
    expect(result.credits).toBe(4);
  });

  test("ignores negative router pricing", () => {
    const result = calculateCreditsFromImageModel({
      pricing: { image: "-1", prompt: "-1", completion: "-1" },
    });

    expect(result.totalUsd).toBe(0);
    expect(result.credits).toBe(0);
  });
});
