import { describe, expect, test } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  inviteTokenPrefix,
  normalizeInviteEmail,
  tokenHashesEqual,
} from "@/lib/org-invites";

describe("org invites utils", () => {
  test("normalizeInviteEmail trims and lowercases", () => {
    expect(normalizeInviteEmail("  TeSt@Example.com ")).toBe("test@example.com");
  });

  test("generateInviteToken returns token, hash, prefix", () => {
    const { token, tokenHash, tokenPrefix } = generateInviteToken();
    expect(token).toBeTypeOf("string");
    expect(token.length).toBeGreaterThan(10);
    expect(tokenPrefix).toBe(inviteTokenPrefix(token));
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(tokenPrefix.length).toBe(8);
  });

  test("tokenHashesEqual compares hashes safely", () => {
    const a = hashInviteToken("token-a");
    const b = hashInviteToken("token-a");
    const c = hashInviteToken("token-b");
    expect(tokenHashesEqual(a, b)).toBe(true);
    expect(tokenHashesEqual(a, c)).toBe(false);
  });
});
