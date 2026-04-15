import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  getUserGoal: vi.fn(),
  getUserTone: vi.fn(),
  getUserAssistantInstructions: vi.fn(),
  loadAuditLogOpsConfig: vi.fn(),
  recordAuditError: vi.fn(),
  purgeAuditLogs: vi.fn(),
  handlersGet: vi.fn(() => new Response("get")),
  handlersPost: vi.fn(() => new Response("post")),
}));

vi.mock("@/lib/user-settings", () => ({
  getUserProfile: mocks.getUserProfile,
  getUserGoal: mocks.getUserGoal,
  getUserTone: mocks.getUserTone,
  getUserAssistantInstructions: mocks.getUserAssistantInstructions,
}));

vi.mock("@/lib/audit-log-config", () => ({
  loadAuditLogOpsConfig: mocks.loadAuditLogOpsConfig,
}));

vi.mock("@/lib/audit-metrics", () => ({
  recordAuditError: mocks.recordAuditError,
}));

vi.mock("@/lib/audit-log-retention", () => ({
  purgeAuditLogs: mocks.purgeAuditLogs,
}));

vi.mock("@/lib/db", () => ({
  prisma: { marker: "prisma" },
}));

vi.mock("@/lib/auth", () => ({
  handlers: {
    GET: mocks.handlersGet,
    POST: mocks.handlersPost,
  },
}));

import { POST as nextAuthPost, GET as nextAuthGet } from "@/app/api/auth/[...nextauth]/route";
import { POST as telegramWebhookPost } from "@/app/api/telegram/webhook/route";
import { runAuditLogPurgeJob } from "@/lib/audit-log-purge-job";
import { startAuditLogPurgeScheduler } from "@/lib/audit-log-purge-scheduler";
import { buildPersonalizationSystemPrompt } from "@/lib/personalization";

const ORIGINAL_ENV = { ...process.env };

describe("small libs and routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.AUDIT_LOG_PURGE_INTERVAL_MS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  test("buildPersonalizationSystemPrompt returns null without settings and joins all provided parts", () => {
    mocks.getUserProfile.mockReturnValue(undefined);
    mocks.getUserGoal.mockReturnValue(undefined);
    mocks.getUserTone.mockReturnValue(undefined);
    mocks.getUserAssistantInstructions.mockReturnValue(undefined);
    expect(buildPersonalizationSystemPrompt({} as never)).toBeNull();

    mocks.getUserProfile.mockReturnValue("Founder");
    mocks.getUserGoal.mockReturnValue("Ship faster");
    mocks.getUserTone.mockReturnValue("Direct");
    mocks.getUserAssistantInstructions.mockReturnValue("Avoid fluff");

    expect(buildPersonalizationSystemPrompt({} as never)).toBe(
      [
        "Следуй персональным настройкам пользователя.",
        "Профиль пользователя: Founder",
        "Цель пользователя: Ship faster",
        "Желаемый тон ответа: Direct",
        "Дополнительные инструкции ассистенту: Avoid fluff",
      ].join("\n")
    );
  });

  test("runAuditLogPurgeJob skips when disabled and prevents concurrent runs", async () => {
    mocks.loadAuditLogOpsConfig.mockReturnValue({
      retention: { enabled: false },
    });

    await expect(runAuditLogPurgeJob()).resolves.toEqual({
      ok: true,
      skipped: true,
      reason: "disabled",
    });

    let release!: () => void;
    mocks.loadAuditLogOpsConfig.mockReturnValue({
      retention: { enabled: true },
    });
    mocks.purgeAuditLogs.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ deletedCount: 2 });
        })
    );

    const first = runAuditLogPurgeJob();
    await expect(runAuditLogPurgeJob()).resolves.toEqual({
      ok: true,
      skipped: true,
      reason: "already_running",
    });
    release();
    await expect(first).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        skipped: false,
        deletedCount: 2,
        jobDurationMs: expect.any(Number),
      })
    );
  });

  test("runAuditLogPurgeJob records metric on purge failure", async () => {
    mocks.loadAuditLogOpsConfig.mockReturnValue({
      retention: { enabled: true },
    });
    mocks.purgeAuditLogs.mockRejectedValue(new Error("boom"));

    await expect(runAuditLogPurgeJob()).resolves.toEqual({
      ok: false,
      error: "PURGE_FAILED",
    });
    expect(mocks.recordAuditError).toHaveBeenCalledWith("purge_job");
  });

  test("startAuditLogPurgeScheduler skips invalid config and starts interval for valid config", async () => {
    mocks.loadAuditLogOpsConfig.mockReturnValue({
      retention: { enabled: false },
    });
    expect(startAuditLogPurgeScheduler()).toEqual({
      ok: true,
      skipped: true,
    });

    vi.resetModules();
    vi.useFakeTimers();
    vi.doMock("@/lib/audit-log-config", () => ({
      loadAuditLogOpsConfig: () => ({ retention: { enabled: true } }),
    }));
    const runAuditLogPurgeJobMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/audit-log-purge-job", () => ({
      runAuditLogPurgeJob: runAuditLogPurgeJobMock,
    }));
    process.env.AUDIT_LOG_PURGE_INTERVAL_MS = "1000";

    const { startAuditLogPurgeScheduler: startFresh } = await import(
      "@/lib/audit-log-purge-scheduler"
    );
    const started = startFresh();

    expect(started).toEqual({
      ok: true,
      stopped: expect.any(Function),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(runAuditLogPurgeJobMock).toHaveBeenCalledTimes(1);
    started.stopped();
  });

  test("telegram webhook echoes update payload and nextauth route re-exports handlers", async () => {
    const webhookResponse = await telegramWebhookPost(
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        body: JSON.stringify({ update_id: 1 }),
      })
    );

    expect(webhookResponse.status).toBe(200);
    expect(await webhookResponse.json()).toEqual({
      ok: true,
      update: { update_id: 1 },
    });

    expect(nextAuthGet).toBe(mocks.handlersGet);
    expect(nextAuthPost).toBe(mocks.handlersPost);
  });
});
