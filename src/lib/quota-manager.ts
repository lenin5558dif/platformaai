import { prisma } from "@/lib/db";
import type { Prisma, QuotaScope as PrismaQuotaScope } from "@prisma/client";

export const DEFAULT_MAX_TOKENS = 4000;

// Period rules:
// - "day" and "month" are computed in UTC using explicit [start, end) boundaries.
// - If the caller does not provide a max token limit for estimation, default to DEFAULT_MAX_TOKENS.

// TTL for "active" reservations. Expired reservations should be ignored by utilization
// and can be cleaned up by a scheduled job.
export const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;

export type QuotaScope = PrismaQuotaScope;

export type QuotaPeriodKind = "day" | "month" | "all_time";

export type QuotaPeriod = {
  kind: QuotaPeriodKind;
  start: Date;
  end: Date;
  key: string;
};

export type QuotaSubject = {
  scope: QuotaScope;
  // For USER/COST_CENTER scopes: the entity id. For ORG scope: the orgId.
  subjectId: string;
};

export type QuotaChain = {
  orgId: string;
  subjects: QuotaSubject[];
};

export type QuotaReserveRequest = {
  chain: QuotaChain;
  period: QuotaPeriod;
  amount: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  // Optional bucket state overrides keyed by `${scope}:${subjectId}`.
  // Used to seed limits/spent from external sources (e.g., user/org settings)
  // when buckets are created.
  bucketStateBySubject?: Record<string, { limit?: number; spent?: number }>;
};

export type QuotaReservationRef = {
  id: string;
  scope: QuotaScope;
  subjectId: string;
  requestId: string;
};

export type QuotaReserveResult = {
  idempotencyKey: string;
  period: QuotaPeriod;
  reservations: QuotaReservationRef[];
};

export function getUtcDayPeriod(now = new Date()): QuotaPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const key = `day:${start.toISOString()}`;
  return { kind: "day", start, end, key };
}

export function getUtcMonthPeriod(now = new Date()): QuotaPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const key = `month:${start.toISOString()}`;
  return { kind: "month", start, end, key };
}

export function getAllTimePeriod(): QuotaPeriod {
  const start = new Date(Date.UTC(1970, 0, 1));
  const end = new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999));
  return { kind: "all_time", start, end, key: "all_time" };
}

export function buildQuotaChain(params: {
  orgId: string;
  userId: string;
  costCenterId?: string;
}): QuotaChain {
  const subjects: QuotaSubject[] = [{ scope: "USER", subjectId: params.userId }];

  if (params.costCenterId) {
    subjects.push({ scope: "COST_CENTER", subjectId: params.costCenterId });
  }

  subjects.push({ scope: "ORG", subjectId: params.orgId });

  return { orgId: params.orgId, subjects };
}

export function buildReservationRequestId(params: {
  idempotencyKey: string;
  periodKey: string;
  scope: QuotaScope;
  subjectId: string;
}) {
  // Use a delimiter that is unlikely to occur in inputs, and that we can reliably parse.
  return `${params.idempotencyKey}|${params.periodKey}|${params.scope}|${params.subjectId}`;
}

export function parseReservationRequestId(requestId: string): {
  idempotencyKey: string;
  periodKey: string;
  scope: QuotaScope;
  subjectId: string;
} | null {
  const parts = requestId.split("|");
  if (parts.length !== 4) return null;
  const [idempotencyKey, periodKey, scope, subjectId] = parts;
  if (!idempotencyKey || !periodKey || !scope || !subjectId) return null;
  return { idempotencyKey, periodKey, scope: scope as QuotaScope, subjectId };
}

export function periodFromKey(periodKey: string): QuotaPeriod {
  if (periodKey === "all_time") return getAllTimePeriod();

  const idx = periodKey.indexOf(":");
  if (idx === -1) {
    throw new Error("INVALID_PERIOD_KEY");
  }

  const kind = periodKey.slice(0, idx) as QuotaPeriodKind;
  const startIso = periodKey.slice(idx + 1);
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error("INVALID_PERIOD_KEY");
  }

  if (kind === "day") {
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
    return { kind, start, end, key: periodKey };
  }

  if (kind === "month") {
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return { kind, start, end, key: periodKey };
  }

  throw new Error("INVALID_PERIOD_KEY");
}

export type QuotaUtilization = {
  limit: number;
  spent: number;
  reserved: number;
};

export type QuotaEvaluateResult =
  | { allowed: true; remaining: number; utilization: QuotaUtilization }
  | { allowed: false; reason: "LIMIT_EXCEEDED"; utilization: QuotaUtilization };

export class QuotaManager {
  constructor(private readonly opts?: { reservationTtlMs?: number }) {}

  private ttlMs() {
    return this.opts?.reservationTtlMs ?? DEFAULT_RESERVATION_TTL_MS;
  }

  private async sumActiveReservedAmount(params: {
    tx: Prisma.TransactionClient;
    orgId: string;
    scope: QuotaScope;
    subjectId: string;
    period: QuotaPeriod;
    now: Date;
    excludeRequestId?: string;
  }) {
    const ttlCutoff = new Date(params.now.getTime() - this.ttlMs());

    const agg = await params.tx.quotaReservation.aggregate({
      where: {
        orgId: params.orgId,
        scope: params.scope,
        subjectId: params.subjectId,
        consumedAt: null,
        releasedAt: null,
        reservedAt: { gte: ttlCutoff },
        requestId: {
          contains: `|${params.period.key}|`,
          not: params.excludeRequestId,
        },
      },
      _sum: { amount: true },
    });

    return Number(agg._sum.amount ?? 0);
  }

  private quotaBucketUniqueWhere(params: {
    scope: QuotaScope;
    subjectId: string;
    period: QuotaPeriod;
  }) {
    return {
      scope_subjectId_periodStart_periodEnd: {
        scope: params.scope,
        subjectId: params.subjectId,
        periodStart: params.period.start,
        periodEnd: params.period.end,
      },
    } as const;
  }

  async getUtilization(params: {
    orgId: string;
    scope: QuotaScope;
    subjectId: string;
    period: QuotaPeriod;
  }): Promise<QuotaUtilization> {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const bucket = await tx.quotaBucket.findUnique({
        where: this.quotaBucketUniqueWhere({
          scope: params.scope,
          subjectId: params.subjectId,
          period: params.period,
        }),
      });

      const spent = Number(bucket?.spent ?? 0);
      const limit = Number(bucket?.limit ?? 0);

      const reserved = await this.sumActiveReservedAmount({
        tx,
        orgId: params.orgId,
        scope: params.scope,
        subjectId: params.subjectId,
        period: params.period,
        now,
      });

      return { limit, spent, reserved };
    });
  }

  async evaluate(params: {
    orgId: string;
    scope: QuotaScope;
    subjectId: string;
    period: QuotaPeriod;
    amount: number;
  }): Promise<QuotaEvaluateResult> {
    const util = await this.getUtilization({
      orgId: params.orgId,
      scope: params.scope,
      subjectId: params.subjectId,
      period: params.period,
    });

    const enforced = util.limit > 0;
    const next = util.spent + util.reserved + params.amount;

    if (enforced && next > util.limit) {
      return { allowed: false, reason: "LIMIT_EXCEEDED", utilization: util };
    }

    const remaining = enforced ? Math.max(0, util.limit - (util.spent + util.reserved)) : Infinity;
    return { allowed: true, remaining, utilization: util };
  }

  async reserve(params: QuotaReserveRequest): Promise<QuotaReserveResult> {
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const reservations: QuotaReservationRef[] = [];

      for (const subject of params.chain.subjects) {
        const stateKey = `${subject.scope}:${subject.subjectId}`;
        const state = params.bucketStateBySubject?.[stateKey];
        const requestId = buildReservationRequestId({
          idempotencyKey: params.idempotencyKey,
          periodKey: params.period.key,
          scope: subject.scope,
          subjectId: subject.subjectId,
        });

        const existing = await tx.quotaReservation.findUnique({
          where: { requestId },
          select: { id: true, requestId: true, scope: true, subjectId: true, consumedAt: true, releasedAt: true },
        });

        if (existing && !existing.consumedAt && !existing.releasedAt) {
          reservations.push({
            id: existing.id,
            scope: existing.scope,
            subjectId: existing.subjectId,
            requestId: existing.requestId,
          });
          continue;
        }

        const bucket = await tx.quotaBucket.upsert({
          where: this.quotaBucketUniqueWhere({
            scope: subject.scope,
            subjectId: subject.subjectId,
            period: params.period,
          }),
          create: {
            orgId: params.chain.orgId,
            scope: subject.scope,
            subjectId: subject.subjectId,
            periodStart: params.period.start,
            periodEnd: params.period.end,
            limit: state?.limit ?? 0,
            spent: state?.spent ?? 0,
            reserved: 0,
          },
          update: state?.limit === undefined ? {} : { limit: state.limit },
          select: { id: true, orgId: true, limit: true, spent: true },
        });

        // Serialize reservations per bucket to avoid oversubscription under concurrency.
        await tx.$queryRaw`SELECT id FROM "QuotaBucket" WHERE id = ${bucket.id} FOR UPDATE`;

        if (bucket.orgId !== params.chain.orgId) {
          throw new Error("QUOTA_BUCKET_ORG_MISMATCH");
        }

        const reservedActive = await this.sumActiveReservedAmount({
          tx,
          orgId: params.chain.orgId,
          scope: subject.scope,
          subjectId: subject.subjectId,
          period: params.period,
          now,
        });

        const limit = Number(bucket.limit ?? 0);
        const spent = Number(bucket.spent ?? 0);

        if (limit > 0 && spent + reservedActive + params.amount > limit) {
          throw new Error("QUOTA_LIMIT_EXCEEDED");
        }

        const created = await tx.quotaReservation.create({
          data: {
            orgId: params.chain.orgId,
            scope: subject.scope,
            subjectId: subject.subjectId,
            requestId,
            amount: params.amount,
            reservedAt: now,
          },
          select: { id: true, requestId: true, scope: true, subjectId: true },
        });

        reservations.push({
          id: created.id,
          scope: created.scope,
          subjectId: created.subjectId,
          requestId: created.requestId,
        });
      }

      return { idempotencyKey: params.idempotencyKey, period: params.period, reservations };
    });
  }

  async commit(params: {
    orgId: string;
    reservations: QuotaReservationRef[];
    finalAmount: number;
  }): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const ref of params.reservations) {
        const parsed = parseReservationRequestId(ref.requestId);
        if (!parsed) {
          throw new Error("INVALID_RESERVATION_REQUEST_ID");
        }

        const reservation = await tx.quotaReservation.findUnique({
          where: { id: ref.id },
          select: {
            id: true,
            orgId: true,
            scope: true,
            subjectId: true,
            requestId: true,
            amount: true,
            consumedAt: true,
            releasedAt: true,
          },
        });

        if (!reservation) continue;
        if (reservation.orgId !== params.orgId) throw new Error("RESERVATION_ORG_MISMATCH");
        if (reservation.consumedAt) continue;
        if (reservation.releasedAt) throw new Error("RESERVATION_ALREADY_RELEASED");

        const reservedAmount = Number(reservation.amount ?? 0);
        if (params.finalAmount > reservedAmount) {
          // Policy: allow overage on commit (the AI call already happened), but make it visible.
          // A separate metrics/monitoring task should alert on overages.
          console.warn("QUOTA_OVERAGE", {
            orgId: params.orgId,
            scope: reservation.scope,
            subjectId: reservation.subjectId,
            periodKey: parsed.periodKey,
            reservedAmount,
            finalAmount: params.finalAmount,
          });
        }

        // Do not mutate quota bucket spent here; spending is accounted for by the caller
        // (e.g. `spendCredits`). Commit just transitions the reservation out of the
        // "active reserved" set.
        await tx.quotaReservation.update({
          where: { id: reservation.id },
          data: {
            amount: params.finalAmount,
            consumedAt: now,
          },
        });
      }
    });
  }

  async release(params: {
    orgId: string;
    reservations: QuotaReservationRef[];
  }): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const ref of params.reservations) {
        const parsed = parseReservationRequestId(ref.requestId);
        if (!parsed) continue;

        const reservation = await tx.quotaReservation.findUnique({
          where: { id: ref.id },
          select: {
            id: true,
            orgId: true,
            scope: true,
            subjectId: true,
            requestId: true,
            amount: true,
            consumedAt: true,
            releasedAt: true,
          },
        });

        if (!reservation) continue;
        if (reservation.orgId !== params.orgId) throw new Error("RESERVATION_ORG_MISMATCH");
        if (reservation.consumedAt) continue;
        if (reservation.releasedAt) continue;

        await tx.quotaReservation.update({
          where: { id: reservation.id },
          data: { releasedAt: now },
        });
      }
    });
  }
}
