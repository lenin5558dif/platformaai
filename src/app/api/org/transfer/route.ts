import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requireSession, createAuthorizer, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

const schema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
});

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_BILLING_MANAGE);

    const payload = schema.parse(await request.json());

    const admin = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, balance: true, costCenterId: true },
    });

    if (!admin) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (Number(admin.balance) < payload.amount) {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 409 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.user.findFirst({
        where: { id: payload.userId, orgId: membership.orgId },
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
      orgId: membership.orgId,
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

    return toErrorResponse(error);
  }
}
