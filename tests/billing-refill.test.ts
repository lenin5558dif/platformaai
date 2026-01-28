import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { refillController } from "../src/app/api/billing/refill/controller";

describe("POST /api/billing/refill", () => {
  it("should return 401 if not authenticated", async () => {
    const mockAuth = vi.fn(async () => null);
    const mockPrisma = { $transaction: vi.fn(async () => undefined) };
    const mockLogAudit = vi.fn();

    const req = new Request("http://localhost/api/billing/refill", {
      method: "POST",
    });
    
    const res = await refillController(req, {
      auth: mockAuth,
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    });
    assert.equal(res.status, 401);
  });

  it("should return 403 if user is not ADMIN", async () => {
    const mockAuth = vi.fn(async () => ({
      user: { id: "user-1", role: "USER" },
    }));
    const mockPrisma = { $transaction: vi.fn(async () => undefined) };
    const mockLogAudit = vi.fn(async () => {});

    const req = new Request("http://localhost/api/billing/refill", {
      method: "POST",
      body: JSON.stringify({ amount: 100 }),
    });

    const res = await refillController(req, {
      auth: mockAuth,
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    });
    assert.equal(res.status, 403);
    
    assert.equal(mockLogAudit.mock.calls.length, 1);
    const calls = mockLogAudit.mock.calls;
    assert.ok(calls.length > 0);
    const auditCall = calls[0]?.[0] as {
      action: string;
      metadata?: { status?: string };
    };
    assert.equal(auditCall.action, "BILLING_REFILL");
    assert.equal(auditCall.metadata.status, "rejected");
  });

  it("should return 201 and update balance if user is ADMIN", async () => {
    process.env.BILLING_REFILL_TOKEN = "test-token";
    const mockAuth = vi.fn(async () => ({
      user: { id: "admin-1", role: "ADMIN" },
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

    const mockPrisma = {
      $transaction: vi.fn(async (callback) => {
        return callback(mockTx);
      }),
    };
    
    const mockLogAudit = vi.fn(async () => {});

    const req = new Request("http://localhost/api/billing/refill", {
      method: "POST",
      headers: { "x-billing-refill-token": "test-token" },
      body: JSON.stringify({ amount: 100 }),
    });

    const res = await refillController(req, {
      auth: mockAuth,
      prisma: mockPrisma,
      logAudit: mockLogAudit,
    });
    assert.equal(res.status, 201);
    
    const data = await res.json();
    assert.equal(data.balance, "200");

    assert.equal(mockLogAudit.mock.calls.length, 1);
    const calls = mockLogAudit.mock.calls;
    assert.ok(calls.length > 0);
    const lastCall = calls[0]?.[0] as {
      action: string;
      metadata?: { status?: string };
    };
    assert.equal(lastCall.action, "BILLING_REFILL");
    assert.equal(lastCall.metadata.status, "success");
  });
});
