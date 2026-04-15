import { describe, expect, test } from "vitest";
import {
  buildInviteAcceptUrl,
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
    const bad = "not-hex";
    expect(tokenHashesEqual(a, b)).toBe(true);
    expect(tokenHashesEqual(a, c)).toBe(false);
    expect(tokenHashesEqual(a, a.slice(0, -2))).toBe(false);
    expect(tokenHashesEqual(a, bad)).toBe(false);
  });

  test("buildInviteAcceptUrl prefers app url and trims trailing slash", () => {
    const originalAppUrl = process.env.APP_URL;
    const originalNextauthUrl = process.env.NEXTAUTH_URL;

    delete process.env.APP_URL;
    delete process.env.NEXTAUTH_URL;
    expect(buildInviteAcceptUrl("abc def")).toBe(
      "http://localhost:3000/invite/accept?token=abc%20def"
    );

    process.env.APP_URL = "https://app.example.com/";
    expect(buildInviteAcceptUrl("abc/def")).toBe(
      "https://app.example.com/invite/accept?token=abc%2Fdef"
    );

    delete process.env.APP_URL;
    process.env.NEXTAUTH_URL = "https://auth.example.com";
    expect(buildInviteAcceptUrl("token")).toBe(
      "https://auth.example.com/invite/accept?token=token"
    );

    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    if (originalNextauthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextauthUrl;
  });
});
