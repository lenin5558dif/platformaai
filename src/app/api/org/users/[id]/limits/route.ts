import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requireSession, createAuthorizer, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

const schema = z.object({
  dailyLimit: z.number().nonnegative().nullable().optional(),
  monthlyLimit: z.number().nonnegative().nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);

    const payload = schema.parse(await request.json());
    const user = await prisma.user.findFirst({
      where: { id, orgId: membership.orgId },
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
      orgId: membership.orgId,
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
  } catch (error) {
    return toErrorResponse(error);
  }
}
