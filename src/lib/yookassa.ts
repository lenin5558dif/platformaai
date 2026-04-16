const YOOKASSA_API_BASE_URL = "https://api.yookassa.ru/v3";

export type YookassaCreatePaymentParams = {
  amountRub: number;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
  idempotenceKey: string;
};

export type YookassaPayment = {
  id: string;
  status?: string;
  confirmation?: {
    type?: string;
    confirmation_url?: string;
  };
};

export function getYookassaConfig() {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;

  if (!shopId) {
    throw new Error("YOOKASSA_SHOP_ID is not set");
  }

  if (!secretKey) {
    throw new Error("YOOKASSA_SECRET_KEY is not set");
  }

  return { shopId, secretKey };
}

export function getYookassaReturnUrl() {
  return (
    process.env.YOOKASSA_RETURN_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000/settings"
  );
}

function toMoneyValue(amountRub: number) {
  return amountRub.toFixed(2);
}

export async function createYookassaPayment(
  params: YookassaCreatePaymentParams
): Promise<YookassaPayment> {
  const { shopId, secretKey } = getYookassaConfig();
  const response = await fetch(`${YOOKASSA_API_BASE_URL}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Idempotence-Key": params.idempotenceKey,
    },
    body: JSON.stringify({
      amount: {
        value: toMoneyValue(params.amountRub),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: params.returnUrl,
      },
      description: params.description,
      metadata: params.metadata,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `YooKassa payment creation failed (${response.status}): ${text || response.statusText}`
    );
  }

  let data: YookassaPayment;
  try {
    data = JSON.parse(text) as YookassaPayment;
  } catch {
    throw new Error("YooKassa payment response is not valid JSON");
  }

  if (!data.id) {
    throw new Error("YooKassa payment response missing payment id");
  }

  return data;
}
