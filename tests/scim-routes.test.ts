import crypto from "crypto";
import { HttpError } from "@/lib/http-error";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  scimAuth: { orgId: "org_1", tokenId: "token_1" } as
    | { orgId: string; tokenId: string }
    | null,
  session: {
    user: {
      id: "user_1",
      orgId: "org_1",
    },
  } as any,
  membership: {
    orgId: "org_1",
  } as any,
  prisma: {
    scimToken: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    costCenter: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      updateMany: vi.fn(),
    },
  },
  authorize: {
    requireSession: vi.fn(),
    createAuthorizer: vi.fn(),
    permissionCheck: vi.fn(),
  },
  scim: {
    validateScimRequest: vi.fn(),
  },
  audit: {
    logAudit: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: state.prisma,
}));

vi.mock("@/lib/scim", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scim")>(
    "@/lib/scim"
  );
  return {
    ...actual,
    validateScimRequest: state.scim.validateScimRequest,
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: state.audit.logAudit,
}));

vi.mock("@/lib/authorize", async () => {
  return {
    requireSession: state.authorize.requireSession,
    createAuthorizer: state.authorize.createAuthorizer,
    toErrorResponse: (error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        "code" in error &&
        "message" in error
      ) {
        const typed = error as { status: number; code: string; message: string };
        return Response.json(
          { error: typed.message, code: typed.code },
          { status: typed.status }
        );
      }
      throw error;
    },
  };
});

import { GET as resourceTypesGet } from "@/app/api/scim/ResourceTypes/route";
import { GET as schemasGet } from "@/app/api/scim/Schemas/route";
import { GET as serviceProviderConfigGet } from "@/app/api/scim/ServiceProviderConfig/route";
import { GET as groupsGet, POST as groupsPost } from "@/app/api/scim/Groups/route";
import { GET as tokensGet, POST as tokensPost, DELETE as tokensDelete } from "@/app/api/scim/tokens/route";

function json(res: Response) {
  return res.json() as Promise<any>;
}

function scimRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function authResponse() {
  return { orgId: "org_1", tokenId: "token_1" };
}

function scimHeaders(res: Response) {
  return res.headers.get("content-type");
}

describe("scim routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.scimAuth = authResponse();
    state.authorize.requireSession.mockResolvedValue(state.session);
    state.authorize.permissionCheck.mockResolvedValue(state.membership);
    state.authorize.createAuthorizer.mockReturnValue({
      requireOrgPermission: state.authorize.permissionCheck,
    });
    state.prisma.scimToken.findMany.mockResolvedValue([]);
    state.prisma.scimToken.create.mockResolvedValue({
      id: "token_1",
      name: "SCIM",
      tokenPrefix: "scim_abc",
    });
    state.prisma.scimToken.deleteMany.mockResolvedValue({ count: 1 });
    state.prisma.costCenter.findMany.mockResolvedValue([]);
    state.prisma.costCenter.create.mockResolvedValue({
      id: "cc_1",
      name: "Finance",
    });
    state.prisma.user.updateMany.mockResolvedValue({ count: 1 });
    state.audit.logAudit.mockResolvedValue(undefined);
    state.scim.validateScimRequest.mockResolvedValue(state.scimAuth);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("ResourceTypes returns unauthorized without a valid SCIM token", async () => {
    state.scim.validateScimRequest.mockResolvedValueOnce(null);

    const res = await resourceTypesGet(scimRequest("http://localhost/api/scim/ResourceTypes"));

    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "Unauthorized" });
  });

  test("ResourceTypes returns SCIM metadata", async () => {
    const res = await resourceTypesGet(scimRequest("http://localhost/api/scim/ResourceTypes"));

    expect(res.status).toBe(200);
    expect(scimHeaders(res)).toContain("application/scim+json");
    expect(await json(res)).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 2,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: [
        {
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: "urn:ietf:params:scim:schemas:core:2.0:User",
          description: "User accounts",
        },
        {
          id: "Group",
          name: "Group",
          endpoint: "/Groups",
          schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
          description: "Cost center groups",
        },
      ],
    });
  });

  test("Schemas returns SCIM schema metadata", async () => {
    const res = await schemasGet(scimRequest("http://localhost/api/scim/Schemas"));

    expect(res.status).toBe(200);
    expect(scimHeaders(res)).toContain("application/scim+json");
    expect((await json(res)).Resources).toHaveLength(2);
  });

  test("Schemas returns unauthorized without a valid SCIM token", async () => {
    state.scim.validateScimRequest.mockResolvedValueOnce(null);

    const res = await schemasGet(scimRequest("http://localhost/api/scim/Schemas"));

    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "Unauthorized" });
  });

  test("ServiceProviderConfig returns SCIM capability metadata", async () => {
    const res = await serviceProviderConfigGet(
      scimRequest("http://localhost/api/scim/ServiceProviderConfig")
    );

    expect(res.status).toBe(200);
    expect(scimHeaders(res)).toContain("application/scim+json");
    expect(await json(res)).toEqual(
      expect.objectContaining({
        patch: { supported: true },
        filter: { supported: true, maxResults: 200 },
        authenticationSchemes: [
          expect.objectContaining({
            type: "oauthbearertoken",
            primary: true,
          }),
        ],
      })
    );
  });

  test("ServiceProviderConfig returns unauthorized without a valid SCIM token", async () => {
    state.scim.validateScimRequest.mockResolvedValueOnce(null);

    const res = await serviceProviderConfigGet(
      scimRequest("http://localhost/api/scim/ServiceProviderConfig")
    );

    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "Unauthorized" });
  });

  test("Groups GET returns unauthorized without a valid SCIM token", async () => {
    state.scim.validateScimRequest.mockResolvedValueOnce(null);

    const res = await groupsGet(scimRequest("http://localhost/api/scim/Groups"));

    expect(res.status).toBe(401);
  });

  test("Groups GET filters by displayName", async () => {
    state.prisma.costCenter.findMany.mockResolvedValueOnce([
      { id: "cc_1", name: "Finance" },
    ]);

    const res = await groupsGet(
      scimRequest(
        "http://localhost/api/scim/Groups?filter=displayName%20eq%20%22Finance%22"
      )
    );

    expect(res.status).toBe(200);
    expect(state.prisma.costCenter.findMany).toHaveBeenCalledWith({
      where: { orgId: "org_1", name: "Finance" },
      orderBy: { name: "asc" },
    });
    expect(await json(res)).toMatchObject({
      totalResults: 1,
      Resources: [{ id: "cc_1", displayName: "Finance" }],
    });
  });

  test("Groups GET filters by id", async () => {
    state.prisma.costCenter.findMany.mockResolvedValueOnce([
      { id: "cc_2", name: "Ops" },
    ]);

    const res = await groupsGet(
      scimRequest("http://localhost/api/scim/Groups?filter=id%20eq%20%22cc_2%22")
    );

    expect(res.status).toBe(200);
    expect(state.prisma.costCenter.findMany).toHaveBeenCalledWith({
      where: { orgId: "org_1", id: "cc_2" },
      orderBy: { name: "asc" },
    });
    expect(await json(res)).toMatchObject({
      totalResults: 1,
      Resources: [{ id: "cc_2", displayName: "Ops" }],
    });
  });

  test("Groups GET without a filter returns all cost centers for the org", async () => {
    state.prisma.costCenter.findMany.mockResolvedValueOnce([
      { id: "cc_1", name: "Finance" },
      { id: "cc_2", name: "Ops" },
    ]);

    const res = await groupsGet(scimRequest("http://localhost/api/scim/Groups"));

    expect(res.status).toBe(200);
    expect(state.prisma.costCenter.findMany).toHaveBeenCalledWith({
      where: { orgId: "org_1" },
      orderBy: { name: "asc" },
    });
    expect((await json(res)).totalResults).toBe(2);
  });

  test("Groups GET falls back to an unfiltered org query for unknown filters", async () => {
    state.prisma.costCenter.findMany.mockResolvedValueOnce([
      { id: "cc_1", name: "Finance" },
      { id: "cc_2", name: "Ops" },
    ]);

    const res = await groupsGet(
      scimRequest("http://localhost/api/scim/Groups?filter=displayName%20co%20%22Fin%22")
    );

    expect(res.status).toBe(200);
    expect(state.prisma.costCenter.findMany).toHaveBeenCalledWith({
      where: { orgId: "org_1" },
      orderBy: { name: "asc" },
    });
    expect((await json(res)).totalResults).toBe(2);
  });

  test("Groups POST rejects missing displayName", async () => {
    const res = await groupsPost(
      scimRequest("http://localhost/api/scim/Groups", {
        method: "POST",
        body: JSON.stringify({ members: [] }),
      })
    );

    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "Missing displayName" });
  });

  test("Groups POST returns unauthorized without a valid SCIM token", async () => {
    state.scim.validateScimRequest.mockResolvedValueOnce(null);

    const res = await groupsPost(
      scimRequest("http://localhost/api/scim/Groups", {
        method: "POST",
        body: JSON.stringify({ displayName: "Finance" }),
      })
    );

    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "Unauthorized" });
  });

  test("Groups POST creates a group, syncs members, and logs audit", async () => {
    const res = await groupsPost(
      scimRequest("http://localhost/api/scim/Groups", {
        method: "POST",
        body: JSON.stringify({
          displayName: "Finance",
          members: [{ value: "user_1" }, { value: "user_2" }],
        }),
      })
    );

    expect(res.status).toBe(201);
    expect(state.prisma.costCenter.create).toHaveBeenCalledWith({
      data: { orgId: "org_1", name: "Finance" },
    });
    expect(state.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["user_1", "user_2"] }, orgId: "org_1" },
      data: { costCenterId: "cc_1" },
    });
    expect(state.audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SCIM_GROUP_SYNC",
        orgId: "org_1",
        targetType: "cost_center",
        targetId: "cc_1",
      })
    );
    expect(await json(res)).toEqual({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: "cc_1",
      displayName: "Finance",
      members: [],
      meta: { resourceType: "Group" },
    });
  });

  test("Tokens GET returns token metadata for the current org", async () => {
    state.prisma.scimToken.findMany.mockResolvedValueOnce([
      {
        id: "token_1",
        name: "SCIM",
        tokenPrefix: "scim_abc",
        createdAt: new Date("2026-04-14T10:00:00.000Z"),
        lastUsedAt: new Date("2026-04-14T11:00:00.000Z"),
      },
    ]);

    const res = await tokensGet(scimRequest("http://localhost/api/scim/tokens"));

    expect(res.status).toBe(200);
    expect(state.authorize.requireSession).toHaveBeenCalledTimes(1);
    expect(state.authorize.createAuthorizer).toHaveBeenCalledWith(state.session);
    expect(state.authorize.permissionCheck).toHaveBeenCalledWith(
      ORG_PERMISSIONS.ORG_SCIM_MANAGE
    );
    expect(state.prisma.scimToken.findMany).toHaveBeenCalledWith({
      where: { orgId: "org_1" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    expect(await json(res)).toEqual({
      data: [
        {
          id: "token_1",
          name: "SCIM",
          tokenPrefix: "scim_abc",
          createdAt: "2026-04-14T10:00:00.000Z",
          lastUsedAt: "2026-04-14T11:00:00.000Z",
        },
      ],
    });
  });

  test("Tokens GET serializes null lastUsedAt values", async () => {
    state.prisma.scimToken.findMany.mockResolvedValueOnce([
      {
        id: "token_2",
        name: "Readonly",
        tokenPrefix: "scim_def",
        createdAt: new Date("2026-04-14T12:00:00.000Z"),
        lastUsedAt: null,
      },
    ]);

    const res = await tokensGet(scimRequest("http://localhost/api/scim/tokens"));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      data: [
        {
          id: "token_2",
          name: "Readonly",
          tokenPrefix: "scim_def",
          createdAt: "2026-04-14T12:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    });
  });

  test("Tokens GET maps auth errors into JSON responses", async () => {
    state.authorize.requireSession.mockRejectedValueOnce(
      new HttpError(401, "UNAUTHORIZED", "Unauthorized")
    );

    const res = await tokensGet(scimRequest("http://localhost/api/scim/tokens"));

    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  test("Tokens POST creates a token and logs audit", async () => {
    vi.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.alloc(24, 2));
    const expectedToken = "scim_" + Buffer.alloc(24, 2).toString("hex");
    const expectedPrefix = expectedToken.slice(0, 8);
    state.prisma.scimToken.create.mockResolvedValueOnce({
      id: "token_2",
      name: "SRE",
      tokenPrefix: expectedPrefix,
    });

    const res = await tokensPost(
      scimRequest("http://localhost/api/scim/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "SRE" }),
      })
    );

    expect(res.status).toBe(200);
    expect(state.authorize.requireSession).toHaveBeenCalledTimes(1);
    expect(state.authorize.createAuthorizer).toHaveBeenCalledWith(state.session);
    expect(state.prisma.scimToken.create).toHaveBeenCalledWith({
      data: {
        orgId: "org_1",
        name: "SRE",
        tokenHash: expect.any(String),
        tokenPrefix: expect.any(String),
      },
    });
    expect(state.audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SCIM_TOKEN_CREATED",
        orgId: "org_1",
        actorId: "user_1",
        targetType: "scim_token",
        targetId: "token_2",
        metadata: { name: "SRE" },
      })
    );
    expect(await json(res)).toEqual({
      data: {
        id: "token_2",
        name: "SRE",
        tokenPrefix: expectedPrefix,
        token: expectedToken,
      },
    });
  });

  test("Tokens POST maps auth errors into JSON responses", async () => {
    state.authorize.requireSession.mockRejectedValueOnce(
      new HttpError(401, "UNAUTHORIZED", "Unauthorized")
    );

    const res = await tokensPost(
      scimRequest("http://localhost/api/scim/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "SRE" }),
      })
    );

    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  test("Tokens DELETE revokes a token and logs audit", async () => {
    const res = await tokensDelete(
      scimRequest("http://localhost/api/scim/tokens", {
        method: "DELETE",
        body: JSON.stringify({ id: "token_2" }),
      })
    );

    expect(res.status).toBe(200);
    expect(state.prisma.scimToken.deleteMany).toHaveBeenCalledWith({
      where: { id: "token_2", orgId: "org_1" },
    });
    expect(state.audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SCIM_TOKEN_REVOKED",
        orgId: "org_1",
        actorId: "user_1",
        targetType: "scim_token",
        targetId: "token_2",
      })
    );
    expect(await json(res)).toEqual({ ok: true });
  });

  test("Tokens DELETE maps auth errors into JSON responses", async () => {
    state.authorize.requireSession.mockRejectedValueOnce(
      new HttpError(401, "UNAUTHORIZED", "Unauthorized")
    );

    const res = await tokensDelete(
      scimRequest("http://localhost/api/scim/tokens", {
        method: "DELETE",
        body: JSON.stringify({ id: "token_2" }),
      })
    );

    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });
});
