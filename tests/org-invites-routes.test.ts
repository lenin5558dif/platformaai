import { beforeEach, describe, expect, test, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { AuditAction } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";

const state = vi.hoisted(() => ({
  authenticated: true,
  orgId: "org_1",
  userId: "user_1",
  email: "invitee@example.com",
  emailVerifiedByProvider: true as boolean | undefined | null,
  perms: new Set<string>(),
  rateLimitOk: true,
  rateLimitRemaining: 9,
  rateLimitResetAt: Date.now() + 3600000,
}));

function makeSession() {
  const session: any = {
    user: {
      id: state.userId,
      orgId: state.orgId,
      email: state.email,
    },
  };
  if (state.emailVerifiedByProvider !== undefined) {
    session.user.emailVerifiedByProvider = state.emailVerifiedByProvider;
  }
  return session;
}

function jsonResponse(res: Response) {
  return res.json() as Promise<any>;
}

const db = {
  roles: new Map<string, any>(),
  invites: new Map<string, any>(),
  memberships: new Map<string, any>(),
  users: new Map<string, any>(),
  costCenters: new Map<string, any>(),
};

const advisoryLocks = new Map<
  string,
  { locked: boolean; waiters: Array<() => void> }
>();

let idSeq = 0;
function newId(prefix: string) {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

function getInviteLockKey(args: any[]) {
  const [query, ...values] = args;
  if (!Array.isArray(query)) return null;
  const sql = String(query[0] ?? "");
  if (!sql.includes("pg_advisory_xact_lock")) return null;
  return `${values[0]}:${values[1]}`;
}

async function acquireAdvisoryLock(lockKey: string) {
  let entry = advisoryLocks.get(lockKey);
  if (!entry) {
    entry = { locked: false, waiters: [] };
    advisoryLocks.set(lockKey, entry);
  }
  if (!entry.locked) {
    entry.locked = true;
    return;
  }

  await new Promise<void>((resolve) => {
    entry!.waiters.push(() => {
      entry!.locked = true;
      resolve();
    });
  });
}

function releaseAdvisoryLock(lockKey: string) {
  const entry = advisoryLocks.get(lockKey);
  if (!entry) return;
  const next = entry.waiters.shift();
  if (next) {
    entry.locked = false;
    next();
    return;
  }
  entry.locked = false;
}

const prisma = {
  orgRole: {
    findFirst: vi.fn(async (args: any) => {
      const { id, orgId } = args.where;
      const role = db.roles.get(id);
      if (!role) return null;
      if (role.orgId !== orgId) return null;
      return args.select ? { id: role.id, name: role.name } : role;
    }),
  },
  costCenter: {
    findFirst: vi.fn(async (args: any) => {
      for (const center of db.costCenters.values()) {
        if (args.where?.id && center.id !== args.where.id) continue;
        if (args.where?.orgId && center.orgId !== args.where.orgId) continue;
        return args.select ? { id: center.id } : center;
      }
      return null;
    }),
  },
  orgInvite: {
    findFirst: vi.fn(async (args: any) => {
      for (const inv of db.invites.values()) {
        if (args.where.id && inv.id !== args.where.id) continue;
        if (args.where.orgId && inv.orgId !== args.where.orgId) continue;
        if (args.where.email && inv.email !== args.where.email) continue;
        if (Object.prototype.hasOwnProperty.call(args.where, "usedAt")) {
          if (args.where.usedAt === null && inv.usedAt !== null) continue;
        }
        if (Object.prototype.hasOwnProperty.call(args.where, "revokedAt")) {
          if (args.where.revokedAt === null && inv.revokedAt !== null) continue;
        }
        if (args.where?.expiresAt?.gt && !(inv.expiresAt > args.where.expiresAt.gt)) continue;
        return args.select ? { id: inv.id } : inv;
      }
      return null;
    }),
    findMany: vi.fn(async (args: any) => {
      const out: any[] = [];
      for (const inv of db.invites.values()) {
        if (args.where?.orgId && inv.orgId !== args.where.orgId) continue;
        if (args.where?.tokenPrefix && inv.tokenPrefix !== args.where.tokenPrefix) continue;
        if (Object.prototype.hasOwnProperty.call(args.where ?? {}, "usedAt")) {
          if (args.where.usedAt === null && inv.usedAt !== null) continue;
        }
        if (Object.prototype.hasOwnProperty.call(args.where ?? {}, "revokedAt")) {
          if (args.where.revokedAt === null && inv.revokedAt !== null) continue;
        }
        if (args.where?.expiresAt?.gt && !(inv.expiresAt > args.where.expiresAt.gt)) continue;
        out.push(inv);
      }
      return out.map((inv) => {
        if (!args.select) return inv;
        return {
          id: inv.id,
          orgId: inv.orgId,
          email: inv.email,
          roleId: inv.roleId,
          defaultCostCenterId: inv.defaultCostCenterId,
          tokenHash: inv.tokenHash,
          tokenPrefix: inv.tokenPrefix,
          expiresAt: inv.expiresAt,
          usedAt: inv.usedAt,
          revokedAt: inv.revokedAt,
          createdAt: inv.createdAt,
          role: inv.role ? { id: inv.role.id, name: inv.role.name } : undefined,
        };
      });
    }),
    create: vi.fn(async (args: any) => {
      const data = args.data;
      const inv = {
        id: newId("invite"),
        orgId: data.orgId,
        email: data.email,
        roleId: data.roleId,
        defaultCostCenterId: data.defaultCostCenterId ?? null,
        tokenHash: data.tokenHash,
        tokenPrefix: data.tokenPrefix,
        expiresAt: data.expiresAt,
        usedAt: null,
        revokedAt: null,
        createdById: data.createdById ?? null,
        createdAt: new Date(),
        role: db.roles.get(data.roleId),
      };
      db.invites.set(inv.id, inv);
      if (!args.select) return inv;
      return {
        id: inv.id,
        email: inv.email,
        roleId: inv.roleId,
        tokenPrefix: inv.tokenPrefix,
        expiresAt: inv.expiresAt,
      };
    }),
    update: vi.fn(async (args: any) => {
      const inv = db.invites.get(args.where.id);
      if (!inv) throw new Error("NOT_FOUND");
      Object.assign(inv, args.data);
      db.invites.set(inv.id, inv);
      return args.select ? { id: inv.id } : inv;
    }),
  },
  orgMembership: {
    upsert: vi.fn(async (args: any) => {
      const key = `${args.where.orgId_userId.orgId}:${args.where.orgId_userId.userId}`;
      const existing = db.memberships.get(key);
      if (existing) {
        Object.assign(existing, args.update);
        db.memberships.set(key, existing);
        return existing;
      }
      const created = { id: newId("m"), ...args.create };
      db.memberships.set(key, created);
      return created;
    }),
  },
  user: {
    update: vi.fn(async (args: any) => {
      const u = db.users.get(args.where.id) ?? { id: args.where.id, orgId: null, email: state.email };
      Object.assign(u, args.data);
      db.users.set(u.id, u);
      return { id: u.id };
    }),
  },
  $transaction: vi.fn(async (fn: any) => {
    const acquiredLocks: string[] = [];
    const tx = {
      ...prisma,
      $executeRaw: vi.fn(async (...args: any[]) => {
        const lockKey = getInviteLockKey(args);
        if (!lockKey) return undefined;
        await acquireAdvisoryLock(lockKey);
        acquiredLocks.push(lockKey);
        return undefined;
      }),
    };
    try {
      return await fn(tx);
    } finally {
      while (acquiredLocks.length > 0) {
        releaseAdvisoryLock(acquiredLocks.pop() as string);
      }
    }
  }),
} as any;

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/unisender", () => ({
  sendOrgInviteEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({
    ok: state.rateLimitOk,
    remaining: state.rateLimitRemaining,
    resetAt: state.rateLimitResetAt,
  })),
  getRateLimitHeaders: vi.fn(() => ({
    "x-ratelimit-limit": "10",
    "x-ratelimit-remaining": String(state.rateLimitRemaining),
    "x-ratelimit-reset": String(Math.ceil(state.rateLimitResetAt / 1000)),
  })),
  getRetryAfterHeader: vi.fn(() => ({
    "retry-after": String(Math.ceil((state.rateLimitResetAt - Date.now()) / 1000)),
  })),
}));
vi.mock("@/lib/authorize", () => {
  function toErrorResponse(error: any) {
    const status = typeof error?.status === "number" ? error.status : 500;
    const code = typeof error?.code === "string" ? error.code : "INTERNAL";
    const message = error?.message ?? "Internal error";
    return new Response(JSON.stringify({ error: message, code }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  async function requireSession() {
    if (!state.authenticated) throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
    return makeSession();
  }

  function createAuthorizer() {
    return {
      async requireOrgPermission(permissionKey: string) {
        if (!state.perms.has(permissionKey)) {
          throw new HttpError(403, "FORBIDDEN", "Forbidden");
        }
        return { orgId: state.orgId };
      },
    };
  }

  return { requireSession, createAuthorizer, toErrorResponse };
});

describe("org invites routes", () => {
  beforeEach(async () => {
    db.invites.clear();
    db.memberships.clear();
    db.users.clear();
    db.roles.clear();
    db.costCenters.clear();
    advisoryLocks.clear();
    idSeq = 0;
    state.authenticated = true;
    state.orgId = "org_1";
    state.userId = "user_1";
    state.email = "invitee@example.com";
    state.emailVerifiedByProvider = true;
    state.perms = new Set(["org:invite.create", "org:invite.revoke"]);
    state.rateLimitOk = true;
    state.rateLimitRemaining = 9;
    state.rateLimitResetAt = Date.now() + 3600000;
    db.roles.set("role_1", { id: "role_1", orgId: "org_1", name: "Member" });
    db.costCenters.set("cc_1", { id: "cc_1", orgId: "org_1", name: "Main" });
    db.costCenters.set("cc_other", { id: "cc_other", orgId: "org_2", name: "Other" });
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("create + list pending invites", async () => {
    const { POST, GET } = await import("../src/app/api/org/invites/route");
    const res = await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: " Invitee@Example.com ", roleId: "role_1" }),
      })
    );
    expect(res.status).toBe(201);
    const body = await jsonResponse(res);
    expect(body.data.email).toBe("invitee@example.com");
    expect(body.data.tokenPrefix).toBeTypeOf("string");
    expect(body.data.token).toBeTypeOf("string");
    expect(body.data.acceptUrl).toContain("token=");

    const list = await GET();
    expect(list.status).toBe(200);
    const listBody = await jsonResponse(list);
    expect(listBody.data).toHaveLength(1);
  });

  test("duplicate pending invite is rejected", async () => {
    const { POST } = await import("../src/app/api/org/invites/route");

    await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.com", roleId: "role_1" }),
      })
    );

    const res2 = await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.com", roleId: "role_1" }),
      })
    );
    expect(res2.status).toBe(409);
    const body2 = await jsonResponse(res2);
    expect(body2.code).toBe("INVITE_EXISTS");
  });

  test("concurrent create requests are serialized per org/email", async () => {
    const { POST } = await import("../src/app/api/org/invites/route");

    const makeRequest = () =>
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "race@b.com", roleId: "role_1" }),
      });

    const [first, second] = await Promise.all([POST(makeRequest()), POST(makeRequest())]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(db.invites.size).toBe(1);
  });

  test("can create new invite after previous was revoked", async () => {
    const { POST } = await import("../src/app/api/org/invites/route");

    const first = await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "recreate@b.com", roleId: "role_1" }),
      })
    );
    const firstBody = await jsonResponse(first);
    db.invites.get(firstBody.data.id).revokedAt = new Date();

    const second = await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "recreate@b.com", roleId: "role_1" }),
      })
    );
    expect(second.status).toBe(201);
  });

  test("can create new invite after previous expired", async () => {
    const { POST } = await import("../src/app/api/org/invites/route");

    const first = await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "expired@b.com", roleId: "role_1" }),
      })
    );
    const firstBody = await jsonResponse(first);
    db.invites.get(firstBody.data.id).expiresAt = new Date(Date.now() - 60_000);

    const second = await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "expired@b.com", roleId: "role_1" }),
      })
    );
    expect(second.status).toBe(201);
  });

  test("create rejects out-of-org defaultCostCenterId", async () => {
    const { POST } = await import("../src/app/api/org/invites/route");
    const res = await POST(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "cc@b.com",
          roleId: "role_1",
          defaultCostCenterId: "cc_other",
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await jsonResponse(res);
    expect(body.code).toBe("INVALID_COST_CENTER");
  });

  test("revoke marks invite revoked and blocks accept", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const inviteId = createdBody.data.id;
    const token = createdBody.data.token;

    const { POST: revoke } = await import(
      "../src/app/api/org/invites/[id]/revoke/route"
    );
    const revoked = await revoke(
      new Request("http://localhost/api/org/invites/x/revoke", { method: "POST" }),
      { params: Promise.resolve({ id: inviteId }) }
    );
    expect(revoked.status).toBe(200);

    state.email = "a@b.com";
    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    const accepted = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(accepted.status).toBe(410);
  });

  test("accept requires auth and enforces email lock", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "match@b.com", roleId: "role_1" }),
      })
    );
    const { token } = (await jsonResponse(created)).data;

    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");

    state.authenticated = false;
    const unauth = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(unauth.status).toBe(401);

    state.authenticated = true;
    state.email = "different@b.com";
    const mismatch = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(mismatch.status).toBe(403);
  });

  test("accept marks invite used and creates membership", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ok@b.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const token = createdBody.data.token;
    const inviteId = createdBody.data.id;

    state.email = "ok@b.com";
    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    const res = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(res.status).toBe(200);
    expect(db.invites.get(inviteId)?.usedAt).not.toBeNull();

    const membershipKey = `${state.orgId}:${state.userId}`;
    expect(db.memberships.get(membershipKey)).toBeTruthy();
  });

  test("accept falls back to null when invite defaultCostCenterId is invalid", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ccsafe@b.com",
          roleId: "role_1",
          defaultCostCenterId: "cc_1",
        }),
      })
    );
    const createdBody = await jsonResponse(created);
    const token = createdBody.data.token;
    const inviteId = createdBody.data.id;

    db.costCenters.delete("cc_1");
    state.email = "ccsafe@b.com";

    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    const res = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );

    expect(res.status).toBe(200);
    expect(db.invites.get(inviteId)?.usedAt).not.toBeNull();
    const membershipKey = `${state.orgId}:${state.userId}`;
    expect(db.memberships.get(membershipKey)?.defaultCostCenterId).toBeNull();
  });

  test("resend rotates token (tokenHash/tokenPrefix change)", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "resend@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const inviteId = createdBody.data.id;
    const oldTokenPrefix = createdBody.data.tokenPrefix;

    // Get the stored invite to check original tokenHash
    const originalInvite = db.invites.get(inviteId);
    const oldTokenHash = originalInvite?.tokenHash;

    // Resend the invite
    const { POST: resend } = await import(
      "../src/app/api/org/invites/[id]/resend/route"
    );
    const resendRes = await resend(
      new Request("http://localhost/api/org/invites/x/resend", { method: "POST" }),
      { params: Promise.resolve({ id: inviteId }) }
    );
    expect(resendRes.status).toBe(200);

    // Verify tokenHash and tokenPrefix changed
    const updatedInvite = db.invites.get(inviteId);
    expect(updatedInvite?.tokenHash).not.toBe(oldTokenHash);
    expect(updatedInvite?.tokenPrefix).not.toBe(oldTokenPrefix);
  });

  test("old token invalid after resend (accept with old token -> 400 INVALID_TOKEN)", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "oldtoken@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const inviteId = createdBody.data.id;
    const oldToken = createdBody.data.token;

    // Resend the invite
    const { POST: resend } = await import(
      "../src/app/api/org/invites/[id]/resend/route"
    );
    await resend(
      new Request("http://localhost/api/org/invites/x/resend", { method: "POST" }),
      { params: Promise.resolve({ id: inviteId }) }
    );

    // Try to accept with old token
    state.email = "oldtoken@test.com";
    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    const acceptRes = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: oldToken }),
      })
    );
    expect(acceptRes.status).toBe(400);
    const body = await jsonResponse(acceptRes);
    expect(body.code).toBe("INVALID_TOKEN");
  });

  test(
    "verified email enforcement (emailVerifiedByProvider=false -> 403 EMAIL_NOT_VERIFIED)",
    async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "unverified@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const token = createdBody.data.token;

    // Set email as unverified
    state.email = "unverified@test.com";
    state.emailVerifiedByProvider = false;

    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    const acceptRes = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(acceptRes.status).toBe(403);
    const body = await jsonResponse(acceptRes);
    expect(body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  test(
    "bypass when emailVerifiedByProvider signal missing (undefined/null -> accept OK)",
    async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "noverify@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const token = createdBody.data.token;
    const inviteId = createdBody.data.id;

    // Set emailVerified as undefined (signal missing)
    state.email = "noverify@test.com";
    state.emailVerifiedByProvider = undefined;

    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    const acceptRes = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(acceptRes.status).toBe(200);
    expect(db.invites.get(inviteId)?.usedAt).not.toBeNull();
  });

  test("create rate limit returns 429 with rate limit headers", async () => {
    state.rateLimitOk = false;
    state.rateLimitRemaining = 0;
    state.rateLimitResetAt = Date.now() + 1800000; // 30 min

    const { POST: create } = await import("../src/app/api/org/invites/route");
    const res = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ratelimit@test.com", roleId: "role_1" }),
      })
    );
    expect(res.status).toBe(429);
    const body = await jsonResponse(res);
    expect(body.code).toBe("RATE_LIMITED");
    expect(res.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: `invite:create:${state.userId}:${state.orgId}`,
        limit: 10,
        windowMs: 3600000,
      })
    );
  });

  test("resend rate limit returns 429 with rate limit headers", async () => {
    // First create an invite
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "resendrate@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const inviteId = createdBody.data.id;

    // Reset rate limit mock to simulate rate limit hit on resend
    state.rateLimitOk = false;
    state.rateLimitRemaining = 0;
    state.rateLimitResetAt = Date.now() + 1800000;

    vi.resetModules();
    const { POST: resend } = await import(
      "../src/app/api/org/invites/[id]/resend/route"
    );
    const res = await resend(
      new Request("http://localhost/api/org/invites/x/resend", { method: "POST" }),
      { params: Promise.resolve({ id: inviteId }) }
    );
    expect(res.status).toBe(429);
    const body = await jsonResponse(res);
    expect(body.code).toBe("RATE_LIMITED");
    expect(res.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  test("accept rate limit returns 429 and audit called with ORG_INVITE_ACCEPT_RATE_LIMITED", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "acceptrate@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const token = createdBody.data.token;

    // Set rate limit to fail
    state.rateLimitOk = false;
    state.rateLimitRemaining = 0;
    state.rateLimitResetAt = Date.now() + 900000; // 15 min

    state.email = "acceptrate@test.com";
    vi.resetModules();
    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    const res = await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(res.status).toBe(429);
    const body = await jsonResponse(res);
    expect(body.code).toBe("RATE_LIMITED");

    // Verify audit was called with ORG_INVITE_ACCEPT_RATE_LIMITED
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ORG_INVITE_ACCEPT_RATE_LIMITED,
        actorId: state.userId,
        metadata: expect.objectContaining({
          invite: expect.objectContaining({
            rateLimited: true,
          }),
        }),
      })
    );
  });

  test("audit event emission for resend", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "auditresend@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const inviteId = createdBody.data.id;

    vi.resetModules();
    const { POST: resend } = await import(
      "../src/app/api/org/invites/[id]/resend/route"
    );
    await resend(
      new Request("http://localhost/api/org/invites/x/resend", { method: "POST" }),
      { params: Promise.resolve({ id: inviteId }) }
    );

    // Find the ORG_INVITE_RESENT call (second call, first is USER_INVITED from create)
    const resentCalls = (logAudit as any).mock.calls.filter(
      (call: any[]) => call[0]?.action === AuditAction.ORG_INVITE_RESENT
    );
    expect(resentCalls).toHaveLength(1);
    expect(resentCalls[0][0]).toMatchObject({
      action: AuditAction.ORG_INVITE_RESENT,
      orgId: state.orgId,
      actorId: state.userId,
      targetType: "OrgInvite",
      targetId: inviteId,
      metadata: {
        invite: {
          resent: true,
        },
      },
    });
  });

  test("audit event emission for unverified rejection", async () => {
    const { POST: create } = await import("../src/app/api/org/invites/route");
    const created = await create(
      new Request("http://localhost/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "auditunverified@test.com", roleId: "role_1" }),
      })
    );
    const createdBody = await jsonResponse(created);
    const token = createdBody.data.token;
    const inviteId = createdBody.data.id;

    state.email = "auditunverified@test.com";
    state.emailVerifiedByProvider = false;

    vi.resetModules();
    const { POST: accept } = await import("../src/app/api/org/invites/accept/route");
    await accept(
      new Request("http://localhost/api/org/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ORG_INVITE_ACCEPT_REJECTED_UNVERIFIED,
        orgId: state.orgId,
        actorId: state.userId,
        targetType: "OrgInvite",
        targetId: inviteId,
        metadata: expect.objectContaining({
          invite: expect.objectContaining({
            email: "auditunverified@test.com",
            rejected: true,
            reason: "email_not_verified",
          }),
        }),
      })
    );
  });
});
