import { describe, expect, test } from "vitest";
import * as bcrypt from "bcryptjs";
import {
  buildTelegramLinkConfirmationPrompt,
  getTelegramAccessBlockMessage,
  getTelegramLinkTokenPrefix,
  isTelegramLinkTokenMatch,
  maskEmail,
  isTelegramAccessRevoked,
} from "@/lib/telegram-linking";

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

  test("covers telegram linking helpers", () => {
    expect(getTelegramLinkTokenPrefix("abcdefghijklmnopqrstuvwxyz")).toBe("abcdefghijklmnop");
    expect(isTelegramAccessRevoked({ globalRevokeCounter: 1 })).toBe(true);
    expect(isTelegramAccessRevoked({ globalRevokeCounter: 0 })).toBe(false);

    const hash = bcrypt.hashSync("plain-token", 10);
    expect(
      isTelegramLinkTokenMatch({
        incomingToken: "plain-token",
        recordToken: "other-token",
        recordHash: hash,
      })
    ).toBe(true);
    expect(
      isTelegramLinkTokenMatch({
        incomingToken: "plain-token",
        recordToken: "plain-token",
      })
    ).toBe(true);
    expect(
      isTelegramLinkTokenMatch({
        incomingToken: "plain-token",
        recordToken: "other-token",
      })
    ).toBe(false);

    expect(maskEmail(null)).toBe("***");
    expect(maskEmail("x@company.com")).toBe("***@company.com");
    expect(maskEmail("user@company.com")).toBe("u***r@company.com");
    expect(maskEmail("not-an-email")).toBe("n***");

    expect(
      buildTelegramLinkConfirmationPrompt({
        maskedEmail: "***@company.com",
        tokenId: "token_1",
      })
    ).toEqual({
      text: "Подтвердите привязку Telegram к аккаунту ***@company.com.",
      confirmData: "tg_link_confirm:token_1",
      cancelData: "tg_link_cancel:token_1",
    });
  });
});
