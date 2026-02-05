import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { UserRole } from "@prisma/client";

// Mock auth module - will be configured per test via mockAuthFn
vi.mock("next-auth", () => ({
  default: vi.fn(),
}));

// Auth mock - use vi.hoisted to allow reference in factory
const { mockAuthFn, mockPrismaDb } = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
  mockPrismaDb: {
    user: {
      findUnique: vi.fn(),
    },
    orgMembership: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuthFn,
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrismaDb,
}));

import { refillController } from "../src/app/api/billing/refill/controller";

const unusedTransaction = async <T>(
  callback: (tx: unknown) => Promise<T>
): Promise<T> => {
  void callback;
  throw new Error("Transaction should not be called in this test");
};

describe("POST /api/billing/refill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 if not authenticated", async () => {
    mockAuthFn.mockResolvedValue(null);

    const mockPrisma = { $transaction: vi.fn(unusedTransaction) };
    const mockLogAudit = vi.fn<
      (params: { action: string; metadata?: { status?: string } }) =>
        Promise<void>
    >();

    const req = new Request("http://localhost/api/billing/refill", {
      method: "POST",
    });
    
    const deps = {
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    } as unknown as Parameters<typeof refillController>[1];
    const res = await refillController(req, deps);
    assert.equal(res.status, 401);
  });

  it("should return 403 if user has no org permission", async () => {
    mockAuthFn.mockResolvedValue({
      user: { id: "user-1", role: UserRole.USER, orgId: "org-1" },
    });

    // User is active
    mockPrismaDb.user.findUnique.mockResolvedValue({ isActive: true });

    // But has no org membership (or no permission)
    mockPrismaDb.orgMembership.findUnique.mockResolvedValue(null);

    const mockPrisma = { $transaction: vi.fn(unusedTransaction) };
    const mockLogAudit = vi.fn<
      (params: { action: string; metadata?: { status?: string } }) =>
        Promise<void>
    >(async () => {});

    const req = new Request("http://localhost/api/billing/refill", {
      method: "POST",
      body: JSON.stringify({ amount: 100 }),
    });

    const deps = {
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    } as unknown as Parameters<typeof refillController>[1];
    const res = await refillController(req, deps);
    assert.equal(res.status, 403);
  });

  it("should return 201 and update balance if user has permission", async () => {
    process.env.BILLING_REFILL_TOKEN = "test-token";

    mockAuthFn.mockResolvedValue({
      user: { id: "admin-1", role: UserRole.ADMIN, orgId: "org-1" },
    });

    // User is active
    mockPrismaDb.user.findUnique.mockResolvedValue({ isActive: true });

    // Has org membership with billing refill permission
    mockPrismaDb.orgMembership.findUnique.mockResolvedValue({
      roleId: "role-1",
      defaultCostCenterId: null,
      role: {
        name: "Admin",
        permissions: [
          { permission: { key: "org:billing.refill" } },
        ],
      },
    });
    
    const mockTx = {
      user: {
        findUnique: vi.fn(async () => ({ costCenterId: "cc-1" })),
        update: vi.fn(async () => ({ balance: 200 })),
      },
      transaction: {
        create: vi.fn(async () => ({ id: "tx-1", amount: 100 })),
      },
    };

    const runTransaction = async <T>(
      callback: (tx: typeof mockTx) => Promise<T>
    ): Promise<T> => callback(mockTx);
    const mockPrisma = { $transaction: vi.fn(runTransaction) };
    
    const mockLogAudit = vi.fn<
      (params: { action: string; metadata?: { status?: string } }) =>
        Promise<void>
    >(async () => {});

    const req = new Request("http://localhost/api/billing/refill", {
      method: "POST",
      headers: { "x-billing-refill-token": "test-token" },
      body: JSON.stringify({ amount: 100 }),
    });

    const deps = {
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    } as unknown as Parameters<typeof refillController>[1];
    const res = await refillController(req, deps);
    assert.equal(res.status, 201);
    
    const data = await res.json();
    assert.equal(data.balance, "200");

    assert.equal(mockLogAudit.mock.calls.length, 1);
    const calls = mockLogAudit.mock.calls;
    assert.ok(calls.length > 0);
    const lastCall = calls[0]?.[0];
    assert.ok(lastCall);
    assert.equal(lastCall.action, "BILLING_REFILL");
    assert.equal(lastCall.metadata?.status, "success");
  });
});
