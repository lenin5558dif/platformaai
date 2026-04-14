import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { applyLimitResets } from "@/lib/limits";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { DEFAULT_RESERVATION_TTL_MS, getAllTimePeriod, getUtcDayPeriod, getUtcMonthPeriod } from "@/lib/quota-manager";

const querySchema = z.object({
  userId: z.string().optional(),
});

async function sumActiveReserved(params: {
  orgId: string;
  scope: "USER" | "ORG";
  subjectId: string;
  periodKey: string;
}) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DEFAULT_RESERVATION_TTL_MS);

  const agg = await prisma.quotaReservation.aggregate({
    where: {
      orgId: params.orgId,
      scope: params.scope,
      subjectId: params.subjectId,
      consumedAt: null,
      releasedAt: null,
      reservedAt: { gte: cutoff },
      requestId: { contains: `|${params.periodKey}|` },
    },
    _sum: { amount: true },
  });

  return Number(agg._sum.amount ?? 0);
}

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);

    const url = new URL(request.url);
    const query = querySchema.parse({
      userId: url.searchParams.get("userId") ?? undefined,
    });

    const org = await prisma.organization.findUnique({
      where: { id: membership.orgId },
      select: { id: true, budget: true, spent: true },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const allTime = getAllTimePeriod();
    const orgReserved = await sumActiveReserved({
      orgId: org.id,
      scope: "ORG",
      subjectId: org.id,
      periodKey: allTime.key,
    });

    let userData: unknown = null;
    if (query.userId) {
      const user = await prisma.user.findFirst({
        where: { id: query.userId, orgId: org.id },
        select: {
          id: true,
          dailyLimit: true,
          monthlyLimit: true,
          dailySpent: true,
          monthlySpent: true,
          dailyResetAt: true,
          monthlyResetAt: true,
        },
      });

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const now = new Date();
      const resets = applyLimitResets({
        dailySpent: Number(user.dailySpent ?? 0),
        monthlySpent: Number(user.monthlySpent ?? 0),
        dailyResetAt: user.dailyResetAt ?? now,
        monthlyResetAt: user.monthlyResetAt ?? now,
      });

      const day = getUtcDayPeriod(now);
      const month = getUtcMonthPeriod(now);
      const dailyReserved = await sumActiveReserved({
        orgId: org.id,
        scope: "USER",
        subjectId: user.id,
        periodKey: day.key,
      });
      const monthlyReserved = await sumActiveReserved({
        orgId: org.id,
        scope: "USER",
        subjectId: user.id,
        periodKey: month.key,
      });

      userData = {
        id: user.id,
        dailyLimit: user.dailyLimit?.toString() ?? null,
        monthlyLimit: user.monthlyLimit?.toString() ?? null,
        dailySpent: resets.dailySpent,
        monthlySpent: resets.monthlySpent,
        dailyReserved,
        monthlyReserved,
        dailyResetAt: resets.dailyResetAt.toISOString(),
        monthlyResetAt: resets.monthlyResetAt.toISOString(),
      };
    }

    return NextResponse.json({
      data: {
        org: {
          id: org.id,
          budget: Number(org.budget ?? 0),
          spent: Number(org.spent ?? 0),
          reserved: orgReserved,
        },
        user: userData,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
