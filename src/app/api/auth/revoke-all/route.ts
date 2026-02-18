import { NextResponse } from "next/server";
import { AuditAction } from "@prisma/client";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revokeAllSessionsForUser } from "@/lib/session-revoke";

export async function POST(request: Request) {
  const session = await auth(request);
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { revokedAt, deletedSessions } = await revokeAllSessionsForUser(
    session.user.id
  );

  await logAudit({
    action: AuditAction.USER_UPDATED,
    orgId: session.user.orgId ?? undefined,
    actorId: session.user.id,
    targetType: "User",
    targetId: session.user.id,
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
    metadata: {
      sessionGlobalRevoke: {
        mode: "SELF",
        revokedAt: revokedAt.toISOString(),
        deletedSessions,
      },
    },
  });

  return NextResponse.json({ ok: true });
}
