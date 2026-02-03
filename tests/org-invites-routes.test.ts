import { beforeEach, describe, expect, test, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const state = vi.hoisted(() => ({
  authenticated: true,
  orgId: "org_1",
  userId: "user_1",
  email: "invitee@example.com",
  perms: new Set<string>(),
}));

function makeSession() {
  return {
    user: {
      id: state.userId,
      orgId: state.orgId,
      email: state.email,
    },
  } as any;
}

function jsonResponse(res: Response) {
  return res.json() as Promise<any>;
}

const db = {
  roles: new Map<string, any>(),
  invites: new Map<string, any>(),
  memberships: new Map<string, any>(),
  users: new Map<string, any>(),
};

let idSeq = 0;
function newId(prefix: string) {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
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
  orgInvite: {
    findFirst: vi.fn(async (args: any) => {
      for (const inv of db.invites.values()) {
        if (args.where.id && inv.id !== args.where.id) continue;
        if (args.where.orgId && inv.orgId !== args.where.orgId) continue;
        if (args.where.email && inv.email !== args.where.email) continue;
        if (Object.prototype.hasOwnProperty.call(args.where, "usedAt")) {
          if (args.where.usedAt === null && inv.usedAt !== null) continue;
        }
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
    const tx = { ...prisma };
    return fn(tx);
  }),
} as any;

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/unisender", () => ({
  sendOrgInviteEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => undefined),
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
    idSeq = 0;
    state.authenticated = true;
    state.orgId = "org_1";
    state.userId = "user_1";
    state.email = "invitee@example.com";
    state.perms = new Set(["org:invite.create", "org:invite.revoke"]);
    db.roles.set("role_1", { id: "role_1", orgId: "org_1", name: "Member" });
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
      { params: { id: inviteId } }
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
});
