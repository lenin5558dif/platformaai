import assert from "node:assert/strict";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    prompt: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import { GET, POST } from "@/app/api/prompts/route";

function jsonResponse(res: Response) {
  return res.json() as Promise<any>;
}

describe("/api/prompts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GLOBAL_ADMIN_EMAILS = "admin@example.com";
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.prisma.user.findUnique.mockResolvedValue({
      orgId: "org-1",
      role: "USER",
      email: "user@example.com",
    });
    mocks.prisma.prompt.findMany.mockResolvedValue([]);
    mocks.prisma.prompt.create.mockResolvedValue({
      id: "prompt-1",
      title: "Prompt title",
      content: "Prompt content",
      orgId: "org-1",
      visibility: "ORG",
      tags: ["one"],
      createdById: "user-1",
    });
  });

  describe("GET /api/prompts", () => {
    test("returns 401 when the session is missing", async () => {
      mocks.auth.mockResolvedValueOnce(null);

      const response = await GET();

      assert.equal(response.status, 401);
      assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
    });

    test("includes org prompts when the user belongs to an org", async () => {
      const response = await GET();

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), { data: [] });
      expect(mocks.prisma.prompt.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { visibility: "GLOBAL" },
            { visibility: "PRIVATE", createdById: "user-1" },
            { visibility: "ORG", orgId: "org-1" },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
    });

    test("omits org prompts when the user has no org", async () => {
      mocks.prisma.user.findUnique.mockResolvedValueOnce({
        orgId: null,
        role: "USER",
        email: "user@example.com",
      });

      const response = await GET();

      assert.equal(response.status, 200);
      expect(mocks.prisma.prompt.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { visibility: "GLOBAL" },
            { visibility: "PRIVATE", createdById: "user-1" },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("POST /api/prompts", () => {
    test("returns 401 when the session is missing", async () => {
      mocks.auth.mockResolvedValueOnce(null);

      const response = await POST(
        new Request("http://localhost/api/prompts", {
          method: "POST",
          body: JSON.stringify({
            title: "Prompt title",
            content: "Prompt content",
          }),
        })
      );

      assert.equal(response.status, 401);
      assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
    });

    test("creates an org prompt by default and normalizes tags", async () => {
      const response = await POST(
        new Request("http://localhost/api/prompts", {
          method: "POST",
          body: JSON.stringify({
            title: "Prompt title",
            content: "Prompt content",
            tags: [" alpha ", "beta", "alpha"],
          }),
        })
      );

      assert.equal(response.status, 201);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          id: "prompt-1",
          title: "Prompt title",
          content: "Prompt content",
          orgId: "org-1",
          visibility: "ORG",
          tags: ["one"],
          createdById: "user-1",
        },
      });
      expect(mocks.prisma.prompt.create).toHaveBeenCalledWith({
        data: {
          title: "Prompt title",
          content: "Prompt content",
          orgId: "org-1",
          visibility: "ORG",
          tags: ["alpha", "beta"],
          createdById: "user-1",
        },
      });
    });

    test("uses GLOBAL scope when visibility is omitted", async () => {
      const response = await POST(
        new Request("http://localhost/api/prompts", {
          method: "POST",
          body: JSON.stringify({
            title: "Prompt title",
            content: "Prompt content",
            scope: "GLOBAL",
          }),
        })
      );

      assert.equal(response.status, 201);
      expect(mocks.prisma.prompt.create).toHaveBeenCalledWith({
        data: {
          title: "Prompt title",
          content: "Prompt content",
          orgId: null,
          visibility: "PRIVATE",
          tags: [],
          createdById: "user-1",
        },
      });
    });

    test("forces GLOBAL visibility to PRIVATE for non-admin users", async () => {
      const response = await POST(
        new Request("http://localhost/api/prompts", {
          method: "POST",
          body: JSON.stringify({
            title: "Prompt title",
            content: "Prompt content",
            visibility: "GLOBAL",
          }),
        })
      );

      assert.equal(response.status, 201);
      expect(mocks.prisma.prompt.create).toHaveBeenCalledWith({
        data: {
          title: "Prompt title",
          content: "Prompt content",
          orgId: null,
          visibility: "PRIVATE",
          tags: [],
          createdById: "user-1",
        },
      });
    });

    test("allows GLOBAL visibility for admins", async () => {
      mocks.prisma.user.findUnique.mockResolvedValueOnce({
        orgId: null,
        role: "ADMIN",
        email: "admin@example.com",
      });

      const response = await POST(
        new Request("http://localhost/api/prompts", {
          method: "POST",
          body: JSON.stringify({
            title: "Prompt title",
            content: "Prompt content",
            visibility: "GLOBAL",
            tags: ["one", "one", "two"],
          }),
        })
      );

      assert.equal(response.status, 201);
      expect(mocks.prisma.prompt.create).toHaveBeenCalledWith({
        data: {
          title: "Prompt title",
          content: "Prompt content",
          orgId: null,
          visibility: "GLOBAL",
          tags: ["one", "two"],
          createdById: "user-1",
        },
      });
    });

    test("restricts GLOBAL visibility for org admins outside the platform allowlist", async () => {
      mocks.prisma.user.findUnique.mockResolvedValueOnce({
        orgId: "org-1",
        role: "ADMIN",
        email: "org-admin@example.com",
      });

      const response = await POST(
        new Request("http://localhost/api/prompts", {
          method: "POST",
          body: JSON.stringify({
            title: "Prompt title",
            content: "Prompt content",
            visibility: "GLOBAL",
          }),
        })
      );

      assert.equal(response.status, 201);
      expect(mocks.prisma.prompt.create).toHaveBeenCalledWith({
        data: {
          title: "Prompt title",
          content: "Prompt content",
          orgId: null,
          visibility: "PRIVATE",
          tags: [],
          createdById: "user-1",
        },
      });
    });
  });
});
