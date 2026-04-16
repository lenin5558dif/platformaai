import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getBillingTier, getBillingTierLabel } from "@/lib/billing-tiers";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      role: true,
      balance: true,
      emailVerifiedByProvider: true,
      settings: true,
      channelBindings: {
        select: {
          channel: true,
          createdAt: true,
        },
      },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const billingTier = getBillingTier(user.settings, user.balance);

  return NextResponse.json({
    data: {
      ...user,
      billingTier,
      billingTierLabel: getBillingTierLabel(billingTier),
      balance: user.balance.toString(),
      channels: user.channelBindings.map((binding) => ({
        channel: binding.channel,
        linkedAt: binding.createdAt.toISOString(),
      })),
    },
  });
}
