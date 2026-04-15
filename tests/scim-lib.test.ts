import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hashScimToken, generateScimToken, validateScimRequest } from "@/lib/scim";

const state = vi.hoisted(() => ({
  prisma: {
    scimToken: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: state.prisma,
}));

describe("scim lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.prisma.scimToken.findFirst.mockReset();
    state.prisma.scimToken.update.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("hashScimToken is deterministic", () => {
    expect(hashScimToken("scim-token")).toBe(hashScimToken("scim-token"));
    expect(hashScimToken("scim-token")).not.toBe(hashScimToken("other-token"));
  });

  test("generateScimToken uses a scim prefix and 24 random bytes", () => {
    vi.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.alloc(24, 0xab));

    expect(generateScimToken()).toBe(
      "scim_" + Buffer.alloc(24, 0xab).toString("hex")
    );
  });

  test("validateScimRequest rejects missing bearer tokens", async () => {
    const request = new Request("http://localhost/api/scim", {
      headers: { authorization: "Basic abc" },
    });

    await expect(validateScimRequest(request)).resolves.toBeNull();
    expect(state.prisma.scimToken.findFirst).not.toHaveBeenCalled();
    expect(state.prisma.scimToken.update).not.toHaveBeenCalled();
  });

  test("validateScimRequest rejects requests with no authorization header", async () => {
    const request = new Request("http://localhost/api/scim");

    await expect(validateScimRequest(request)).resolves.toBeNull();
    expect(state.prisma.scimToken.findFirst).not.toHaveBeenCalled();
    expect(state.prisma.scimToken.update).not.toHaveBeenCalled();
  });

  test("validateScimRequest rejects unknown or mismatched tokens", async () => {
    state.prisma.scimToken.findFirst.mockResolvedValueOnce({
      id: "token_1",
      tokenHash: "different-hash",
      orgId: "org_1",
    });

    const token = "scim_1234567890abcdef";
    const request = new Request("http://localhost/api/scim", {
      headers: { authorization: `Bearer ${token}` },
    });

    await expect(validateScimRequest(request)).resolves.toBeNull();
    expect(state.prisma.scimToken.findFirst).toHaveBeenCalledWith({
      where: { tokenPrefix: token.slice(0, 8) },
      select: { id: true, tokenHash: true, orgId: true },
    });
    expect(state.prisma.scimToken.update).not.toHaveBeenCalled();
  });

  test("validateScimRequest returns org context and updates lastUsedAt", async () => {
    const token = "scim_1234567890abcdef";
    const tokenHash = hashScimToken(token);
    state.prisma.scimToken.findFirst.mockResolvedValueOnce({
      id: "token_1",
      tokenHash,
      orgId: "org_1",
    });
    state.prisma.scimToken.update.mockResolvedValueOnce({ id: "token_1" });

    const request = new Request("http://localhost/api/scim", {
      headers: { authorization: `bearer ${token}` },
    });

    await expect(validateScimRequest(request)).resolves.toEqual({
      orgId: "org_1",
      tokenId: "token_1",
    });
    expect(state.prisma.scimToken.update).toHaveBeenCalledWith({
      where: { id: "token_1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
