import { describe, expect, it } from "vitest";
import {
  mapGovernanceError,
  normalizeQuotaStatus,
  statusBadgeClass,
  statusLabel,
} from "@/lib/governance-ui";

describe("governance-ui helpers", () => {
  it("normalizes quota status", () => {
    expect(normalizeQuotaStatus(100, 10)).toBe("ok");
    expect(normalizeQuotaStatus(100, 85)).toBe("warning");
    expect(normalizeQuotaStatus(100, 120)).toBe("blocked");
    expect(normalizeQuotaStatus(0, 10)).toBe("unknown");
    expect(normalizeQuotaStatus(null, 10)).toBe("unknown");
  });

  it("maps known errors", () => {
    expect(mapGovernanceError("FORBIDDEN").tone).toBe("warning");
    expect(mapGovernanceError("RATE_LIMITED").title).toContain("запросов");
    expect(mapGovernanceError("INVALID_INPUT").tone).toBe("error");
  });

  it("provides safe fallback for unknown errors", () => {
    const message = mapGovernanceError("SOMETHING_NEW");
    expect(message.tone).toBe("error");
    expect(message.message.length).toBeGreaterThan(0);
  });

  it("maps status labels and badge classes", () => {
    expect(statusLabel("ok")).toBe("ok");
    expect(statusLabel("unknown")).toBe("unknown");
    expect(statusBadgeClass("blocked")).toContain("red");
    expect(statusBadgeClass("warning")).toContain("amber");
  });
});
