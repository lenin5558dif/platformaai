type QuotaScope = "USER" | "COST_CENTER" | "ORG";

type QuotaBucket = {
  id: string;
  orgId: string;
  scope: QuotaScope;
  subjectId: string;
  periodStart: Date;
  periodEnd: Date;
  limit: number;
  spent: number;
  reserved: number;
};

type QuotaReservation = {
  id: string;
  orgId: string;
  scope: QuotaScope;
  subjectId: string;
  requestId: string;
  amount: number;
  reservedAt: Date;
  consumedAt: Date | null;
  releasedAt: Date | null;
};

type Tx = {
  quotaBucket: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
  quotaReservation: {
    findUnique(args: any): Promise<any>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
    aggregate(args: any): Promise<any>;
  };
  $queryRaw(strings: TemplateStringsArray, ...values: any[]): Promise<any>;
};

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const prev = this.tail;
    this.tail = this.tail.then(() => next);
    await prev;
    return release;
  }
}

function pick<T extends Record<string, unknown>>(obj: T, select?: Record<string, boolean>) {
  if (!select) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (v) out[k] = (obj as any)[k];
  }
  return out;
}

function cloneBucket(b: QuotaBucket): QuotaBucket {
  return { ...b, periodStart: new Date(b.periodStart), periodEnd: new Date(b.periodEnd) };
}

function cloneReservation(r: QuotaReservation): QuotaReservation {
  return {
    ...r,
    reservedAt: new Date(r.reservedAt),
    consumedAt: r.consumedAt ? new Date(r.consumedAt) : null,
    releasedAt: r.releasedAt ? new Date(r.releasedAt) : null,
  };
}

export function createFakeQuotaPrisma() {
  let idSeq = 0;

  const locks = new Map<string, Mutex>();
  const buckets = new Map<string, QuotaBucket>();
  const reservations = new Map<string, QuotaReservation>();
  const reservationsByRequestId = new Map<string, string>();

  function newId() {
    idSeq += 1;
    return `cuid_${idSeq}`;
  }

  function bucketKey(params: { scope: QuotaScope; subjectId: string; periodStart: Date; periodEnd: Date }) {
    return `${params.scope}|${params.subjectId}|${params.periodStart.toISOString()}|${params.periodEnd.toISOString()}`;
  }

  function snapshot() {
    return {
      buckets: Array.from(buckets.values()).map(cloneBucket),
      reservations: Array.from(reservations.values()).map(cloneReservation),
    };
  }

  function reset() {
    buckets.clear();
    reservations.clear();
    reservationsByRequestId.clear();
    locks.clear();
    idSeq = 0;
  }

  function getOrCreateMutex(key: string) {
    const existing = locks.get(key);
    if (existing) return existing;
    const m = new Mutex();
    locks.set(key, m);
    return m;
  }

  function findReservationByRequestId(requestId: string, overlay?: Map<string, QuotaReservation>) {
    const localId = overlay ? Array.from(overlay.values()).find((r) => r.requestId === requestId)?.id : undefined;
    if (localId) return { id: localId, row: overlay!.get(localId)! };
    const id = reservationsByRequestId.get(requestId);
    if (!id) return null;
    const row = reservations.get(id);
    if (!row) return null;
    return { id, row };
  }

  async function runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const localBuckets = new Map<string, QuotaBucket>();
    const localReservations = new Map<string, QuotaReservation>();
    const acquiredReleases: Array<() => void> = [];

    const tx: Tx = {
      quotaBucket: {
        async findUnique(args: any) {
          const w = args?.where?.scope_subjectId_periodStart_periodEnd;
          const key = bucketKey({
            scope: w.scope,
            subjectId: w.subjectId,
            periodStart: new Date(w.periodStart),
            periodEnd: new Date(w.periodEnd),
          });

          const local = localBuckets.get(key);
          if (local) return pick(cloneBucket(local), args.select);
          const global = buckets.get(key);
          if (!global) return null;
          return pick(cloneBucket(global), args.select);
        },

        async upsert(args: any) {
          const w = args?.where?.scope_subjectId_periodStart_periodEnd;
          const key = bucketKey({
            scope: w.scope,
            subjectId: w.subjectId,
            periodStart: new Date(w.periodStart),
            periodEnd: new Date(w.periodEnd),
          });

          // Emulate the DB uniqueness guarantee for (scope, subjectId, periodStart, periodEnd)
          // so that concurrent upserts do not create two buckets.
          const preExisting = localBuckets.get(key) ?? buckets.get(key);
          if (!preExisting) {
            const mutex = getOrCreateMutex(`bucketkey:${key}`);
            const release = await mutex.lock();
            acquiredReleases.push(release);
          }

          const existing = localBuckets.get(key) ?? buckets.get(key);
          if (!existing) {
            const created: QuotaBucket = {
              id: newId(),
              orgId: args.create.orgId,
              scope: args.create.scope,
              subjectId: args.create.subjectId,
              periodStart: new Date(args.create.periodStart),
              periodEnd: new Date(args.create.periodEnd),
              limit: Number(args.create.limit ?? 0),
              spent: Number(args.create.spent ?? 0),
              reserved: Number(args.create.reserved ?? 0),
            };
            localBuckets.set(key, created);
            return pick(cloneBucket(created), args.select);
          }

          const updated: QuotaBucket = cloneBucket(existing);
          if (args.update) {
            if (Object.prototype.hasOwnProperty.call(args.update, "limit")) {
              updated.limit = Number(args.update.limit ?? 0);
            }
            if (Object.prototype.hasOwnProperty.call(args.update, "spent")) {
              updated.spent = Number(args.update.spent ?? 0);
            }
            if (Object.prototype.hasOwnProperty.call(args.update, "reserved")) {
              updated.reserved = Number(args.update.reserved ?? 0);
            }
          }
          localBuckets.set(key, updated);
          return pick(cloneBucket(updated), args.select);
        },
      },

      quotaReservation: {
        async findUnique(args: any) {
          if (args?.where?.requestId) {
            const found = findReservationByRequestId(args.where.requestId, localReservations);
            if (!found) return null;
            return pick(cloneReservation(found.row), args.select);
          }

          if (args?.where?.id) {
            const local = localReservations.get(args.where.id);
            if (local) return pick(cloneReservation(local), args.select);
            const global = reservations.get(args.where.id);
            if (!global) return null;
            return pick(cloneReservation(global), args.select);
          }

          return null;
        },

        async aggregate(args: any) {
          const where = args?.where ?? {};
          const ttlCutoff = where.reservedAt?.gte ? new Date(where.reservedAt.gte) : null;
          const contains = where.requestId?.contains;
          const notId = where.requestId?.not;

          const all = [
            ...Array.from(reservations.values()),
            ...Array.from(localReservations.values()),
          ];

          const filtered = all.filter((r) => {
            if (where.orgId && r.orgId !== where.orgId) return false;
            if (where.scope && r.scope !== where.scope) return false;
            if (where.subjectId && r.subjectId !== where.subjectId) return false;
            if (where.consumedAt === null && r.consumedAt !== null) return false;
            if (where.releasedAt === null && r.releasedAt !== null) return false;
            if (ttlCutoff && r.reservedAt < ttlCutoff) return false;
            if (contains && !r.requestId.includes(String(contains))) return false;
            if (notId && r.requestId === notId) return false;
            return true;
          });

          const sum = filtered.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
          return { _sum: { amount: sum } };
        },

        async create(args: any) {
          const data = args?.data;
          const requestId = String(data.requestId);
          const existing = findReservationByRequestId(requestId, localReservations);
          if (existing) throw new Error("UNIQUE_REQUEST_ID_VIOLATION");

          const created: QuotaReservation = {
            id: newId(),
            orgId: String(data.orgId),
            scope: data.scope,
            subjectId: String(data.subjectId),
            requestId,
            amount: Number(data.amount ?? 0),
            reservedAt: data.reservedAt ? new Date(data.reservedAt) : new Date(),
            consumedAt: null,
            releasedAt: null,
          };
          localReservations.set(created.id, created);
          return pick(cloneReservation(created), args.select);
        },

        async update(args: any) {
          const id = String(args?.where?.id);
          const existing = localReservations.get(id) ?? reservations.get(id);
          if (!existing) throw new Error("NOT_FOUND");

          const updated: QuotaReservation = cloneReservation(existing);
          const data = args?.data ?? {};
          if (Object.prototype.hasOwnProperty.call(data, "amount")) updated.amount = Number(data.amount ?? 0);
          if (Object.prototype.hasOwnProperty.call(data, "consumedAt")) {
            updated.consumedAt = data.consumedAt ? new Date(data.consumedAt) : null;
          }
          if (Object.prototype.hasOwnProperty.call(data, "releasedAt")) {
            updated.releasedAt = data.releasedAt ? new Date(data.releasedAt) : null;
          }

          localReservations.set(id, updated);
          return pick(cloneReservation(updated), args.select);
        },
      },

      async $queryRaw(_strings: TemplateStringsArray, ...values: any[]) {
        // QuotaManager uses: SELECT id FROM "QuotaBucket" WHERE id = ${bucket.id} FOR UPDATE
        const bucketId = String(values[0]);
        const mutex = getOrCreateMutex(`bucket:${bucketId}`);
        const release = await mutex.lock();
        acquiredReleases.push(release);
        return [{ id: bucketId }];
      },
    };

    try {
      const result = await fn(tx);

      // Commit buckets
      for (const b of localBuckets.values()) {
        buckets.set(bucketKey(b), cloneBucket(b));
      }

      // Commit reservations
      for (const r of localReservations.values()) {
        reservations.set(r.id, cloneReservation(r));
        reservationsByRequestId.set(r.requestId, r.id);
      }

      return result;
    } finally {
      for (const release of acquiredReleases.reverse()) {
        try {
          release();
        } catch {
          // ignore
        }
      }
    }
  }

  const prisma = {
    $transaction: runTransaction,
  } as any;

  return { prisma, reset, snapshot };
}
