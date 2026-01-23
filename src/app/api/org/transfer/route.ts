import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = schema.parse(await request.json());

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, orgId: true, balance: true, costCenterId: true },
  });

  if (!admin?.orgId || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (Number(admin.balance) < payload.amount) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.user.findFirst({
        where: { id: payload.userId, orgId: admin.orgId },
        select: { id: true, costCenterId: true },
      });

      if (!member) {
        throw new Error("MEMBER_NOT_FOUND");
      }

      await tx.user.update({
        where: { id: admin.id },
        data: { balance: { decrement: payload.amount } },
      });

      await tx.user.update({
        where: { id: member.id },
        data: { balance: { increment: payload.amount } },
      });

      const spendTx = await tx.transaction.create({
        data: {
          userId: admin.id,
          costCenterId: admin.costCenterId ?? undefined,
          amount: payload.amount,
          type: "SPEND",
          description: `Перевод сотруднику ${member.id}`,
        },
      });

      const refillTx = await tx.transaction.create({
        data: {
          userId: member.id,
          costCenterId: member.costCenterId ?? undefined,
          amount: payload.amount,
          type: "REFILL",
          description: "Пополнение от администратора",
        },
      });

      return { spendTx, refillTx };
    });

    await logAudit({
      action: "USER_UPDATED",
      orgId: admin.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: payload.userId,
      metadata: { transferAmount: payload.amount },
    });

    return NextResponse.json(
      {
        spendTx: {
          ...result.spendTx,
          amount: result.spendTx.amount.toString(),
        },
        refillTx: {
          ...result.refillTx,
          amount: result.refillTx.amount.toString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "MEMBER_NOT_FOUND") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    throw error;
  }
}
