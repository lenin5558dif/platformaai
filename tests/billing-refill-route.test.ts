import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { marker: "prisma" },
  logAudit: vi.fn(),
  refillController: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/app/api/billing/refill/controller", () => ({
  refillController: mocks.refillController,
}));

import { POST } from "@/app/api/billing/refill/route";

describe("POST /api/billing/refill route wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refillController.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );
  });

  test("delegates request and dependencies to refillController", async () => {
    const request = new Request("http://localhost/api/billing/refill", {
      method: "POST",
      body: JSON.stringify({ amount: 50 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.refillController).toHaveBeenCalledWith(request, {
      prisma: mocks.prisma,
      logAudit: mocks.logAudit,
    });
  });
});
