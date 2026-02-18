import { describe, expect, it } from "vitest";
import {
  mapTelegramLinkingError,
  maskedIdentityHint,
} from "@/lib/telegram-linking-ui";

describe("telegram-linking-ui helpers", () => {
  it("maps known error categories", () => {
    expect(mapTelegramLinkingError("RATE_LIMITED").tone).toBe("warning");
    expect(mapTelegramLinkingError("TOKEN_EXPIRED").title).toContain("истекла");
    expect(mapTelegramLinkingError("TOKEN_USED_OR_CONFLICT").tone).toBe("warning");
    expect(mapTelegramLinkingError("UNAUTHORIZED").tone).toBe("warning");
  });

  it("returns fallback message for unknown errors", () => {
    const mapped = mapTelegramLinkingError("SOMETHING_NEW");
    expect(mapped.tone).toBe("error");
    expect(mapped.message.length).toBeGreaterThan(0);
  });

  it("builds masked identity hint", () => {
    expect(maskedIdentityHint("user@company.com", "Acme")).toContain("Acme");
    expect(maskedIdentityHint("user@company.com", null)).toContain("@");
    expect(maskedIdentityHint(null, null)).toContain("***");
  });
});
