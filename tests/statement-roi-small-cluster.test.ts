import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  runAuditLogPurgeJob: vi.fn(),
  requireCronSecret: vi.fn(),
  jsonNoStore: vi.fn(),
  chatApp: vi.fn(() => "chat-app"),
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  requireSession: vi.fn(),
  createAuthorizer: vi.fn(),
  toErrorResponse: vi.fn(),
  prisma: {
    user: {
      findMany: vi.fn(),
    },
    eventLog: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit-log-purge-job", () => ({
  runAuditLogPurgeJob: mocks.runAuditLogPurgeJob,
}));

vi.mock("@/lib/internal-http", () => ({
  requireCronSecret: mocks.requireCronSecret,
  jsonNoStore: mocks.jsonNoStore,
}));

vi.mock("@/components/chat/ChatApp", () => ({
  default: () => mocks.chatApp(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/auth", () => ({
  requirePageSession: async () => {
    const session = await mocks.auth();
    if (!session?.user?.id) {
      return mocks.redirect("/login?mode=signin");
    }
    return session;
  },
}));

vi.mock("@/lib/authorize", () => ({
  requireSession: mocks.requireSession,
  createAuthorizer: mocks.createAuthorizer,
  toErrorResponse: mocks.toErrorResponse,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import Home from "@/app/page";
import { POST as auditLogPurgePost } from "@/app/api/internal/cron/audit-log-purge/route";
import { GET as exportEventsGet } from "@/app/api/events/export/route";
import { sendMagicLink, sendOrgInviteEmail } from "@/lib/unisender";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

describe("statement ROI small cluster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.UNISENDER_API_KEY;
    delete process.env.UNISENDER_SENDER_EMAIL;
    delete process.env.UNISENDER_SENDER_NAME;
    globalThis.fetch = mocks.fetch as typeof globalThis.fetch;

    mocks.jsonNoStore.mockImplementation((body: unknown) => Response.json(body));
    mocks.auth.mockResolvedValue({ user: { id: "home-user" } });
    mocks.requireSession.mockResolvedValue({ user: { id: "actor-1" } });
    mocks.createAuthorizer.mockReturnValue({
      requireOrgPermission: vi.fn().mockResolvedValue({ orgId: "org-1" }),
    });
    mocks.toErrorResponse.mockImplementation((error: unknown) => {
      if (error instanceof Response) return error;
      return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
    });
    mocks.prisma.user.findMany.mockResolvedValue([{ id: "u-1" }, { id: "u-2" }]);
    mocks.prisma.eventLog.findMany.mockResolvedValue([
      {
        id: "e-1",
        createdAt: new Date("2026-04-14T10:00:00.000Z"),
        type: "AI_REQUEST",
        userId: "u-1",
        chatId: "c-1",
        modelId: "m-1",
        message: 'hello "world"',
        payload: { ok: true },
      },
    ]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("sendMagicLink and sendOrgInviteEmail validate env, send requests, and surface API errors", async () => {
    await expect(
      sendMagicLink({ email: "user@example.com", url: "https://app.example/magic" })
    ).rejects.toThrow("UNISENDER_API_KEY is not set");
    await expect(
      sendOrgInviteEmail({
        email: "invitee@example.com",
        acceptUrl: "https://app.example/invite",
      })
    ).rejects.toThrow("UNISENDER_API_KEY is not set");

    process.env.UNISENDER_API_KEY = "unisender-key";
    await expect(
      sendMagicLink({ email: "user@example.com", url: "https://app.example/magic" })
    ).rejects.toThrow("UNISENDER_SENDER_EMAIL is not set");
    await expect(
      sendOrgInviteEmail({
        email: "invitee@example.com",
        acceptUrl: "https://app.example/invite",
      })
    ).rejects.toThrow("UNISENDER_SENDER_EMAIL is not set");

    process.env.UNISENDER_SENDER_EMAIL = "noreply@example.com";

    mocks.fetch.mockResolvedValueOnce({ ok: true } as Response);
    await expect(
      sendMagicLink({ email: "user@example.com", url: "https://app.example/magic" })
    ).resolves.toBeUndefined();

    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.unisender.com/ru/api/sendEmail",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: expect.any(URLSearchParams),
      })
    );

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "mail error",
    } as Response);
    await expect(
      sendMagicLink({ email: "user@example.com", url: "https://app.example/magic" })
    ).rejects.toThrow("UniSender error: mail error");

    mocks.fetch.mockResolvedValueOnce({ ok: true } as Response);
    await expect(
      sendOrgInviteEmail({
        email: "invitee@example.com",
        acceptUrl: "https://app.example/invite",
      })
    ).resolves.toBeUndefined();

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      "https://api.unisender.com/ru/api/sendEmail",
      expect.objectContaining({
        body: expect.any(URLSearchParams),
      })
    );

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "bad request",
    } as Response);
    await expect(
      sendOrgInviteEmail({
        email: "invitee@example.com",
        acceptUrl: "https://app.example/invite",
      })
    ).rejects.toThrow("UniSender error: bad request");
  });

  test("audit-log purge route short-circuits unauthorized and wraps successful job result", async () => {
    const unauthorized = new Response(JSON.stringify({ error: "UNAUTHORIZED" }), {
      status: 401,
    });
    mocks.requireCronSecret.mockReturnValueOnce(unauthorized);

    expect(
      await auditLogPurgePost(new Request("http://localhost/api/internal/cron/audit-log-purge"))
    ).toBe(unauthorized);

    mocks.requireCronSecret.mockReturnValueOnce(null);
    mocks.runAuditLogPurgeJob.mockResolvedValueOnce({ ok: true, deletedCount: 5 });

    const response = await auditLogPurgePost(
      new Request("http://localhost/api/internal/cron/audit-log-purge", {
        method: "POST",
        headers: { "x-cron-secret": "secret" },
      })
    );

    expect(mocks.runAuditLogPurgeJob).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(mocks.jsonNoStore).toHaveBeenCalledWith({ ok: true, deletedCount: 5 });
    expect(await response.json()).toEqual({ ok: true, deletedCount: 5 });
  });

  test("home page renders suspense fallback wrapper and ChatApp", async () => {
    const html = renderToStaticMarkup(await Home());

    expect(html).toContain("chat-app");
    expect(mocks.chatApp).toHaveBeenCalledTimes(1);
  });

  test("home page redirects to login without session", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("NEXT_REDIRECT:/login?mode=signin");
  });

  test("events export route enforces auth, clamps limit, filters events, and escapes csv", async () => {
    const mapped = new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    mocks.requireSession.mockRejectedValueOnce(mapped);
    expect(
      await exportEventsGet(new Request("http://localhost/api/events/export"))
    ).toBe(mapped);

    const response = await exportEventsGet(
      new Request(
        "http://localhost/api/events/export?type=AI_REQUEST&model=%20m-1%20&limit=5000"
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=events.csv"
    );
    expect(mocks.prisma.eventLog.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ["u-1", "u-2"] },
        type: "AI_REQUEST",
        modelId: "m-1",
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    const csv = await response.text();
    expect(csv).toContain('"id","createdAt","type","userId","chatId","modelId","message","payload"');
    expect(csv).toContain('"e-1"');
    expect(csv).toContain('"hello ""world"""');
    expect(csv).toContain('"{""ok"":true}"');
  });
});
