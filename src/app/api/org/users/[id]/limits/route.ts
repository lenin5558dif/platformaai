import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  dailyLimit: z.number().nonnegative().nullable().optional(),
  monthlyLimit: z.number().nonnegative().nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, role: true },
  });

  if (!admin?.orgId || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = schema.parse(await request.json());
  const user = await prisma.user.findFirst({
    where: { id, orgId: admin.orgId },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      dailyLimit: payload.dailyLimit ?? undefined,
      monthlyLimit: payload.monthlyLimit ?? undefined,
    },
    select: {
      id: true,
      dailyLimit: true,
      monthlyLimit: true,
    },
  });

  await logAudit({
    action: "USER_UPDATED",
    orgId: admin.orgId,
    actorId: session.user.id,
    targetType: "user",
    targetId: user.id,
    metadata: {
      dailyLimit: payload.dailyLimit ?? null,
      monthlyLimit: payload.monthlyLimit ?? null,
    },
  });

  return NextResponse.json({
    data: {
      ...updated,
      dailyLimit: updated.dailyLimit?.toString() ?? null,
      monthlyLimit: updated.monthlyLimit?.toString() ?? null,
    },
  });
}
