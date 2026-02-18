import { describe, expect, test } from "vitest";
import { getTelegramAccessBlockMessage } from "@/lib/telegram-linking";

describe("telegram access", () => {
  test("blocks deactivated user", () => {
    const msg = getTelegramAccessBlockMessage({
      isActive: false,
      globalRevokeCounter: 0,
    });
    expect(msg).toContain("деактивирован");
  });

  test("blocks revoked user", () => {
    const msg = getTelegramAccessBlockMessage({
      isActive: true,
      globalRevokeCounter: 1,
    });
    expect(msg).toContain("отозван");
  });

  test("allows active non-revoked user", () => {
    const msg = getTelegramAccessBlockMessage({
      isActive: true,
      globalRevokeCounter: 0,
    });
    expect(msg).toBeNull();
  });
});
