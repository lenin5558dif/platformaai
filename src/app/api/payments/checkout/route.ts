import { NextResponse } from "next/server";
import { getPaymentProvider } from "@/lib/payments-provider";
import { POST as postStripeCheckout } from "@/app/api/payments/stripe/checkout/route";

export async function POST(request: Request) {
  const provider = getPaymentProvider();

  if (provider === "stripe") {
    return postStripeCheckout(request);
  }

  if (provider === "yookassa") {
    return NextResponse.json(
      { error: "YooKassa checkout is not implemented yet" },
      { status: 501 }
    );
  }

  return NextResponse.json(
    { error: "No payment provider is configured" },
    { status: 503 }
  );
}
