import assert from "node:assert/strict";
import crypto from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  scimGroupResource,
  scimListResponse,
  scimUserResource,
} from "@/lib/scim-responses";

const mocks = vi.hoisted(() => ({
  validateScimRequest: vi.fn(),
  requireSession: vi.fn(),
  createAuthorizer: vi.fn(),
  toErrorResponse: vi.fn(),
  logAudit: vi.fn(),
  prisma: {
    scimToken: {
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/authorize", () => ({
  requireSession: mocks.requireSession,
  createAuthorizer: mocks.createAuthorizer,
  toErrorResponse: mocks.toErrorResponse,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

function jsonError(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function importScimProtectedRoutes() {
  vi.resetModules();
  vi.doMock("@/lib/scim", () => ({
    validateScimRequest: mocks.validateScimRequest,
  }));

  const [resourceTypes, schemas, serviceProviderConfig] = await Promise.all([
    import("@/app/api/scim/ResourceTypes/route"),
    import("@/app/api/scim/Schemas/route"),
    import("@/app/api/scim/ServiceProviderConfig/route"),
  ]);

  return {
    getResourceTypes: resourceTypes.GET,
    getSchemas: schemas.GET,
    getServiceProviderConfig: serviceProviderConfig.GET,
  };
}

describe("scim coverage local", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "actor-1" } });
    mocks.createAuthorizer.mockReturnValue({
      requireOrgPermission: vi.fn().mockResolvedValue({ orgId: "org-1" }),
    });
    mocks.toErrorResponse.mockImplementation((error: unknown) => {
      if (error instanceof Response) return error;
      return jsonError(500, { error: String(error) });
    });
    mocks.prisma.scimToken.findMany.mockResolvedValue([]);
    mocks.prisma.scimToken.create.mockResolvedValue({
      id: "token-1",
      name: "Main token",
      tokenPrefix: "scim_abc",
    });
    mocks.prisma.scimToken.deleteMany.mockResolvedValue({ count: 1 });
  });

  test("hashScimToken, generateScimToken, and validateScimRequest work with bearer auth", async () => {
    const { generateScimToken, hashScimToken, validateScimRequest } = await import(
      "@/lib/scim"
    );

    const generated = generateScimToken();
    expect(generated).toMatch(/^scim_[a-f0-9]{48}$/);
    expect(hashScimToken("secret")).toBe(
      crypto.createHash("sha256").update("secret").digest("hex")
    );

    const token = "scim_secret_token";
    const tokenHash = hashScimToken(token);
    mocks.prisma.scimToken.findFirst.mockResolvedValueOnce(null);
    await expect(
      validateScimRequest(new Request("http://localhost", { headers: {} }))
    ).resolves.toBeNull();
    await expect(
      validateScimRequest(
        new Request("http://localhost", {
          headers: { authorization: "Bearer wrong" },
        })
      )
    ).resolves.toBeNull();

    mocks.prisma.scimToken.findFirst.mockResolvedValueOnce({
      id: "token-1",
      tokenHash,
      orgId: "org-1",
    });
    await expect(
      validateScimRequest(
        new Request("http://localhost", {
          headers: { authorization: `Bearer ${token}` },
        })
      )
    ).resolves.toEqual({ orgId: "org-1", tokenId: "token-1" });
    expect(mocks.prisma.scimToken.findFirst).toHaveBeenLastCalledWith({
      where: { tokenPrefix: token.slice(0, 8) },
      select: { id: true, tokenHash: true, orgId: true },
    });
    expect(mocks.prisma.scimToken.update).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  test("resource and schema endpoints require scim auth and return SCIM content", async () => {
    const {
      getResourceTypes,
      getSchemas,
      getServiceProviderConfig,
    } = await importScimProtectedRoutes();

    mocks.validateScimRequest.mockResolvedValueOnce(null);
    const unauthorized = await getResourceTypes(new Request("http://localhost"));
    expect(unauthorized.status).toBe(401);

    mocks.validateScimRequest.mockResolvedValue({ orgId: "org-1", tokenId: "token-1" });

    const [resourceTypes, schemas, spc] = await Promise.all([
      getResourceTypes(new Request("http://localhost")),
      getSchemas(new Request("http://localhost")),
      getServiceProviderConfig(new Request("http://localhost")),
    ]);

    assert.equal(resourceTypes.headers.get("content-type"), "application/scim+json");
    expect(await resourceTypes.json()).toMatchObject({
      totalResults: 2,
      Resources: expect.arrayContaining([
        expect.objectContaining({ id: "User", endpoint: "/Users" }),
        expect.objectContaining({ id: "Group", endpoint: "/Groups" }),
      ]),
    });
    expect(await schemas.json()).toMatchObject({
      totalResults: 2,
      Resources: expect.arrayContaining([
        expect.objectContaining({ id: "urn:ietf:params:scim:schemas:core:2.0:User" }),
      ]),
    });
    expect(await spc.json()).toMatchObject({
      patch: { supported: true },
      filter: { supported: true, maxResults: 200 },
    });
  });

  test("scim tokens route lists, creates, deletes, and maps errors", async () => {
    vi.doUnmock("@/lib/scim");
    const { DELETE, GET, POST } = await import("@/app/api/scim/tokens/route");

    mocks.prisma.scimToken.findMany.mockResolvedValueOnce([
      {
        id: "token-1",
        name: "Main token",
        tokenPrefix: "scim_abc",
        createdAt: new Date("2026-04-14T00:00:00.000Z"),
        lastUsedAt: null,
      },
    ]);

    const listResponse = await GET();
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      data: [
        {
          id: "token-1",
          name: "Main token",
          tokenPrefix: "scim_abc",
          createdAt: "2026-04-14T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    });

    const createResponse = await POST(
      new Request("http://localhost/api/scim/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "Main token" }),
      })
    );
    expect(createResponse.status).toBe(200);
    expect(await createResponse.json()).toEqual({
      data: {
        id: "token-1",
        name: "Main token",
        tokenPrefix: "scim_abc",
        token: expect.stringMatching(/^scim_[a-f0-9]{48}$/),
      },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SCIM_TOKEN_CREATED",
        orgId: "org-1",
        actorId: "actor-1",
      })
    );
    expect(mocks.prisma.scimToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        name: "Main token",
        tokenPrefix: expect.any(String),
        tokenHash: expect.any(String),
      }),
    });

    const deleteResponse = await DELETE(
      new Request("http://localhost/api/scim/tokens", {
        method: "DELETE",
        body: JSON.stringify({ id: "token-1" }),
      })
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true });
    expect(mocks.prisma.scimToken.deleteMany).toHaveBeenCalledWith({
      where: { id: "token-1", orgId: "org-1" },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SCIM_TOKEN_REVOKED",
        targetId: "token-1",
      })
    );

    const mapped = jsonError(403, { error: "forbidden" });
    mocks.requireSession.mockRejectedValueOnce(mapped);
    expect(await GET()).toBe(mapped);
  });

  test("scim response helpers fall back to safe defaults", () => {
    expect(scimListResponse([])).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 0,
      Resources: [],
    });

    expect(
      scimUserResource(
        {
          id: "user-2",
          email: null,
          telegramId: null,
          isActive: false,
        } as never,
        null
      )
    ).toMatchObject({
      id: "user-2",
      userName: "user-2",
      displayName: "user-2",
      emails: [],
      groups: [],
    });

    expect(
      scimGroupResource({ id: "cc-2", name: "Support" } as never)
    ).toMatchObject({
      id: "cc-2",
      displayName: "Support",
      members: [],
    });
  });
});
