import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: session.user.id },
      select: { costCenterId: true },
    });

    const transaction = await tx.transaction.create({
      data: {
        userId: session.user.id,
        costCenterId: user?.costCenterId ?? undefined,
        amount: payload.amount,
        type: "REFILL",
        description: payload.description ?? "Пополнение баланса",
      },
    });

    const updated = await tx.user.update({
      where: { id: session.user.id },
      data: {
        balance: { increment: payload.amount },
      },
      select: { balance: true },
    });

    return { transaction, balance: updated.balance };
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
}
