import { describe, expect, test } from "vitest";
import {
  buildTelegramLinkAuditMetadata,
  buildTelegramUnlinkAuditMetadata,
} from "@/lib/telegram-audit";

describe("telegram audit metadata", () => {
  test("buildTelegramLinkAuditMetadata shape", () => {
    const md = buildTelegramLinkAuditMetadata({
      telegramId: "123",
      source: "bot",
      maskedEmail: "u***r@example.com",
    });

    expect(md).toEqual({
      telegram: {
        action: "link",
        telegramId: "123",
        source: "bot",
        maskedEmail: "u***r@example.com",
      },
    });
  });

  test("buildTelegramUnlinkAuditMetadata shape", () => {
    const md = buildTelegramUnlinkAuditMetadata({ telegramId: "123", source: "web" });
    expect(md).toEqual({
      telegram: {
        action: "unlink",
        telegramId: "123",
        source: "web",
      },
    });
  });
});
