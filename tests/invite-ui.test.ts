import { describe, expect, it } from "vitest";
import { mapInviteError, parseInviteActionResult } from "@/lib/invite-ui";

describe("invite-ui helpers", () => {
  it("maps known invite errors to user-safe messages", () => {
    expect(mapInviteError("INVITE_EXISTS").tone).toBe("warning");
    expect(mapInviteError("INVITE_EMAIL_MISMATCH").tone).toBe("error");
    expect(mapInviteError("EMAIL_NOT_VERIFIED").title).toContain("Email");
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
});
