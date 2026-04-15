import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments-provider";
import { POST as postStripeSubscriptionCheckout } from "@/app/api/payments/stripe/subscription/checkout/route";

export async function POST(request: Request) {
  const provider = getPaymentProvider();

  if (provider === "stripe") {
    return postStripeSubscriptionCheckout(request);
  }

  if (provider === "yookassa") {
    return NextResponse.json(
      { error: "YooKassa subscriptions are temporarily unavailable" },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { error: "No payment provider is configured" },
    { status: 503 }
  );
}
