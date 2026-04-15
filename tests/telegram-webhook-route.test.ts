import { beforeEach, describe, expect, test, vi } from "vitest";

describe("telegram webhook route", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  test("fails closed when webhook mode is not configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const { POST } = await import("../src/app/api/telegram/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 1 }),
      })
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "TELEGRAM_WEBHOOK_DISABLED",
    });
  });

  test("rejects implemented-looking webhook calls with 503 instead of silent ack", async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "secret";

    const { POST } = await import("../src/app/api/telegram/webhook/route");
    const res = await POST(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "secret" },
        body: JSON.stringify({ update_id: 1 }),
      })
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: "TELEGRAM_WEBHOOK_NOT_IMPLEMENTED",
    });
  });
});
