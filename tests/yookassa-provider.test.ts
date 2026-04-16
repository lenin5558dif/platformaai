import { beforeEach, describe, expect, test, vi } from "vitest";

describe("yookassa provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("YOOKASSA_SHOP_ID", "shop_1");
    vi.stubEnv("YOOKASSA_SECRET_KEY", "secret_1");
    vi.stubEnv("YOOKASSA_RETURN_URL", "http://app.test/settings");
  });

  test("returns config from env", async () => {
    const { getYookassaConfig, getYookassaReturnUrl } = await import("../src/lib/yookassa");

    expect(getYookassaConfig()).toEqual({
      shopId: "shop_1",
      secretKey: "secret_1",
    });
    expect(getYookassaReturnUrl()).toBe("http://app.test/settings");
  });

  test("creates payment request with basic auth and confirmation url", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          id: "pay_123",
          confirmation: {
            type: "redirect",
            confirmation_url: "https://yookassa.test/confirm",
          },
        }),
    }));

    vi.stubGlobal("fetch", fetchMock);
    const { createYookassaPayment } = await import("../src/lib/yookassa");

    const payment = await createYookassaPayment({
      amountRub: 1500,
      description: "PlatformaAI • 1500 ₽",
      returnUrl: "http://app.test/settings",
      metadata: { userId: "user_1" },
      idempotenceKey: "idem-1",
    });

    expect(payment.id).toBe("pay_123");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.yookassa.ru/v3/payments",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("Basic "),
          "Content-Type": "application/json",
          "Idempotence-Key": "idem-1",
        }),
      })
    );
  });
});
