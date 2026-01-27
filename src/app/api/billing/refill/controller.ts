import { NextResponse } from "next/server";
import { z } from "zod";
import { UserRole, AuditAction } from "@prisma/client";
import type { Prisma } from "@prisma/client";

const schema = z.object({
  amount: z.number().positive(),
  description: z.string().optional(),
});

type RefillControllerDeps = {
  auth: () => Promise<{
    user?: { id?: string | null; role?: UserRole | null } | null;
  } | null>;
  prisma: {
    $transaction: <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>
    ) => Promise<T>;
  };
  logAudit: (params: {
    action: AuditAction;
    orgId?: string | null;
    actorId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) => Promise<void> | void;
};

export async function refillController(
  request: Request,
  deps: RefillControllerDeps
) {
  const { auth, prisma, logAudit } = deps;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const body = await request.json();
  const payload = schema.parse(body);

  if (session.user.role !== UserRole.ADMIN) {
    await logAudit({
      action: "BILLING_REFILL" as AuditAction,
      actorId: userId,
      metadata: {
        amount: payload.amount,
        status: "rejected",
        reason: "forbidden",
      },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const refillToken = process.env.BILLING_REFILL_TOKEN;
  if (!refillToken) {
    await logAudit({
      action: "BILLING_REFILL" as AuditAction,
      actorId: userId,
      metadata: {
        amount: payload.amount,
        status: "rejected",
        reason: "refill_disabled",
      },
    });
    return NextResponse.json(
      { error: "Refill not configured" },
      { status: 503 }
    );
  }

  const providedToken = request.headers.get("x-billing-refill-token");
  if (providedToken !== refillToken) {
    await logAudit({
      action: "BILLING_REFILL" as AuditAction,
      actorId: userId,
      metadata: {
        amount: payload.amount,
        status: "rejected",
        reason: "invalid_token",
      },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { costCenterId: true },
    });

    const transaction = await tx.transaction.create({
      data: {
        userId,
        costCenterId: user?.costCenterId ?? undefined,
        amount: payload.amount,
        type: "REFILL",
        description: payload.description ?? "Пополнение баланса",
      },
    });

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        balance: { increment: payload.amount },
      },
      select: { balance: true },
    });

    return { transaction, balance: updated.balance };
  });

  await logAudit({
    action: "BILLING_REFILL" as AuditAction,
    actorId: userId,
    targetId: result.transaction.id,
    targetType: "Transaction",
    metadata: {
      amount: payload.amount,
      status: "success",
      balanceAfter: result.balance.toString(),
    },
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
