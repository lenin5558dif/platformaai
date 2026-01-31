import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { UserRole } from "@prisma/client";
import { refillController } from "../src/app/api/billing/refill/controller";

const unusedTransaction = async <T>(
  _callback: (tx: unknown) => Promise<T>
): Promise<T> => {
  throw new Error("Transaction should not be called in this test");
};

describe("POST /api/billing/refill", () => {
  it("should return 401 if not authenticated", async () => {
    const mockAuth = vi.fn(async () => null);
    const mockPrisma = { $transaction: vi.fn(unusedTransaction) };
    const mockLogAudit = vi.fn<
      (params: { action: string; metadata?: { status?: string } }) =>
        Promise<void>
    >();

    const req = new Request("http://localhost/api/billing/refill", {
      method: "POST",
    });
    
    const deps = {
      auth: mockAuth,
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    } as unknown as Parameters<typeof refillController>[1];
    const res = await refillController(req, deps);
    assert.equal(res.status, 401);
  });

  it("should return 403 if user is not ADMIN", async () => {
    const mockAuth = vi.fn(async () => ({
      user: { id: "user-1", role: UserRole.USER },
    }));
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
      auth: mockAuth,
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    } as unknown as Parameters<typeof refillController>[1];
    const res = await refillController(req, deps);
    assert.equal(res.status, 403);
    
    assert.equal(mockLogAudit.mock.calls.length, 1);
    const calls = mockLogAudit.mock.calls;
    assert.ok(calls.length > 0);
    const auditCall = calls[0]?.[0];
    assert.ok(auditCall);
    assert.equal(auditCall.action, "BILLING_REFILL");
    assert.equal(auditCall.metadata?.status, "rejected");
  });

  it("should return 201 and update balance if user is ADMIN", async () => {
    process.env.BILLING_REFILL_TOKEN = "test-token";
    const mockAuth = vi.fn(async () => ({
      user: { id: "admin-1", role: UserRole.ADMIN },
    }));
    
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
      auth: mockAuth,
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
