import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { spendCredits } from "@/lib/billing";

const schema = z.object({
  amount: z.number().positive(),
  description: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = schema.parse(await request.json());

  try {
    const result = await spendCredits({
      userId: session.user.id,
      amount: payload.amount,
      description: payload.description,
    });

    return NextResponse.json(
      {
        transaction: {
          ...result.transaction,
          amount: result.transaction.amount.toString(),
        },
        balance: result.balance.toString(),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json(
        { error: "Insufficient balance" },
        { status: 409 }
      );
    }

    if (error instanceof Error && error.message === "DAILY_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { error: "Daily limit exceeded" },
        { status: 409 }
      );
    }

    if (error instanceof Error && error.message === "MONTHLY_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { error: "Monthly limit exceeded" },
        { status: 409 }
      );
    }

    if (error instanceof Error && error.message === "ORG_BUDGET_EXCEEDED") {
      return NextResponse.json(
        { error: "Organization budget exceeded" },
        { status: 409 }
      );
    }

    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    throw error;
  }
}
