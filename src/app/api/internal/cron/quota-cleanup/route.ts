import { prisma } from "@/lib/db";
import { DEFAULT_RESERVATION_TTL_MS } from "@/lib/quota-manager";
import { jsonNoStore, requireCronSecret } from "@/lib/internal-http";

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const cutoff = new Date(now.getTime() - DEFAULT_RESERVATION_TTL_MS);

  const res = await prisma.quotaReservation.updateMany({
    where: {
      consumedAt: null,
      releasedAt: null,
      reservedAt: { lt: cutoff },
    },
    data: { releasedAt: now },
  });

  const activeWhere = {
    consumedAt: null,
    releasedAt: null,
    reservedAt: { gte: cutoff },
  } as const;

  const activeCount = await prisma.quotaReservation.count({ where: activeWhere });
  const activeSum = await prisma.quotaReservation.aggregate({
    where: activeWhere,
    _sum: { amount: true },
  });

  const consumedSinceCutoff = await prisma.quotaReservation.count({
    where: {
      consumedAt: { gte: cutoff },
    },
  });

  return jsonNoStore({
    released: res.count,
    activeCount,
    activeAmount: Number(activeSum._sum.amount ?? 0),
    consumedSinceCutoff,
    cutoff: cutoff.toISOString(),
  });
}
