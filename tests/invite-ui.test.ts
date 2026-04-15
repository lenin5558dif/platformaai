import { describe, expect, it } from "vitest";
import { mapInviteError, parseInviteActionResult } from "@/lib/invite-ui";

describe("invite-ui helpers", () => {
  it.each([
    ["RATE_LIMITED", "warning"],
    ["INVITE_EXISTS", "warning"],
    ["INVITE_EXPIRED", "warning"],
    ["INVITE_REVOKED", "warning"],
    ["INVITE_ALREADY_USED", "warning"],
    ["INVITE_EMAIL_MISMATCH", "error"],
    ["EMAIL_REQUIRED", "warning"],
    ["EMAIL_NOT_VERIFIED", "warning"],
    ["EMAIL_DOMAIN_BLOCKED", "error"],
    ["ROLE_NOT_FOUND", "error"],
    ["INVALID_TOKEN", "error"],
    ["UNAUTHORIZED", "warning"],
  ])("maps %s to a %s tone", (code, tone) => {
    const message = mapInviteError(code);
    expect(message.tone).toBe(tone);
    expect(message.title.length).toBeGreaterThan(0);
    expect(message.message.length).toBeGreaterThan(0);
  });

  it("returns fallback message for unknown errors", () => {
    const message = mapInviteError("SOMETHING_NEW");
    expect(message.tone).toBe("error");
    expect(message.message.length).toBeGreaterThan(0);
  });

  it("parses successful action result", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const result = await parseInviteActionResult(response);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("parses failed action result with code", async () => {
    const response = new Response(
      JSON.stringify({ code: "INVITE_REVOKED", message: "revoked" }),
      { status: 410 }
    );
    const result = await parseInviteActionResult(response);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVITE_REVOKED");
    expect(result.status).toBe(410);
  });

  it("parses failed action result with invalid JSON", async () => {
    const response = new Response("not-json", { status: 500 });
    const result = await parseInviteActionResult(response);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.code).toBeUndefined();
    expect(result.message).toBeUndefined();
  });
});
