import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { buildTelegramUnlinkAuditMetadata } from "@/lib/telegram-audit";

export async function DELETE() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, orgId: true, telegramId: true },
  });

  if (!user?.telegramId) {
    return new Response(null, { status: 204 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { telegramId: null },
    select: { id: true },
  });

  await logAudit({
    action: AuditAction.TELEGRAM_UNLINKED,
    orgId: user.orgId ?? undefined,
    actorId: user.id,
    targetType: "User",
    targetId: user.id,
    metadata: buildTelegramUnlinkAuditMetadata({ telegramId: user.telegramId, source: "web" }),
  });

  return new Response(null, { status: 204 });
}
