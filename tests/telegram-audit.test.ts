import { describe, expect, test } from "vitest";
import {
  buildTelegramLinkAuditMetadata,
  buildTelegramUnlinkAuditMetadata,
} from "@/lib/telegram-audit";

describe("telegram audit metadata", () => {
  test("includes optional masked email only when present", () => {
    expect(
      buildTelegramLinkAuditMetadata({
        telegramId: "tg-1",
        source: "bot",
        maskedEmail: "u***@example.com",
      })
    ).toEqual({
      telegram: {
        action: "link",
        telegramId: "tg-1",
        source: "bot",
        maskedEmail: "u***@example.com",
      },
    });

    expect(
      buildTelegramLinkAuditMetadata({
        telegramId: "tg-2",
        source: "web",
      })
    ).toEqual({
      telegram: {
        action: "link",
        telegramId: "tg-2",
        source: "web",
        maskedEmail: undefined,
      },
    });
  });

  test("builds unlink metadata", () => {
    expect(
      buildTelegramUnlinkAuditMetadata({
        telegramId: "tg-3",
        source: "web",
      })
    ).toEqual({
      telegram: {
        action: "unlink",
        telegramId: "tg-3",
        source: "web",
      },
    });
  });
});
