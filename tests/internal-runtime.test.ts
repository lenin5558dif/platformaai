import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { metricsRegistry } from "@/lib/metrics";

const state = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  loadAuditLogOpsConfig: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };
const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/platformaai",
  AUTH_SECRET: "auth-secret",
  NEXTAUTH_URL: "https://app.example",
  NEXT_PUBLIC_APP_URL: "https://app.example",
  OPENROUTER_API_KEY: "openrouter-key",
  UNISENDER_API_KEY: "unisender-key",
  YOOKASSA_SHOP_ID: "yookassa-shop",
  YOOKASSA_SECRET_KEY: "yookassa-secret",
};

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: state.queryRaw,
  },
}));

vi.mock("@/lib/audit-log-config", () => ({
  loadAuditLogOpsConfig: state.loadAuditLogOpsConfig,
}));

function applyEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    ...REQUIRED_ENV,
    ...overrides,
  };
}

function defaultAuditLogConfig() {
  return {
    retention: {
      enabled: false,
      days: 90,
      batchSize: 1000,
      batchDelayMs: 100,
      maxRuntimeMinutes: 5,
      dryRun: false,
    },
    metrics: {
      enabled: false,
      actionTypesWhitelist: [],
    },
  };
}

async function importFresh<T>(path: string): Promise<T> {
  vi.resetModules();
  return import(path) as Promise<T>;
}

describe("internal runtime ops routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsRegistry.resetForTests();
    state.loadAuditLogOpsConfig.mockReturnValue(defaultAuditLogConfig());
    applyEnv({
      NODE_ENV: "test",
      CRON_SECRET: "test-secret",
      AUDIT_LOG_RETENTION_ENABLED: "0",
      AUDIT_LOG_METRICS_ENABLED: "0",
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("health route returns a cache-safe payload", async () => {
    const { GET } = await import("../src/app/api/internal/health/route");

    const res = GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(body).toMatchObject({
      status: "ok",
      service: "platformaai",
      nodeEnv: "test",
    });
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptimeSeconds).toBe("number");
  });

  test("getHealthStatus falls back to unknown when env fields are missing", async () => {
    delete process.env.NODE_ENV;
    delete process.env.npm_package_version;

    const { getHealthStatus } = await importFresh<typeof import("../src/lib/internal-runtime")>(
      "../src/lib/internal-runtime"
    );
    const status = getHealthStatus();

    expect(status.nodeEnv).toBe("unknown");
    expect(status.version).toBe("unknown");
  });

  test("readiness route returns ready when db and ops config are valid", async () => {
    state.queryRaw.mockResolvedValueOnce([{ ok: 1 }]);

    const { GET } = await import("../src/app/api/internal/readiness/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "database", ok: true }),
        expect.objectContaining({ name: "audit_log_config", ok: true }),
      ])
    );
  });

  test("readiness route returns 503 when db check fails", async () => {
    state.queryRaw.mockRejectedValueOnce(new Error("db down"));

    const { GET } = await import("../src/app/api/internal/readiness/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "database", ok: false }),
      ])
    );
  });

  test("getReadinessStatus records non-Error database and audit config failures", async () => {
    state.queryRaw.mockRejectedValueOnce("db down");
    state.loadAuditLogOpsConfig.mockImplementation(() => {
      throw "audit config broken";
    });

    const { getReadinessStatus } = await importFresh<typeof import("../src/lib/internal-runtime")>(
      "../src/lib/internal-runtime"
    );
    const status = await getReadinessStatus();

    expect(status.status).toBe("not_ready");
    expect(status.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "database",
          ok: false,
          error: "DATABASE_UNAVAILABLE",
        }),
        expect.objectContaining({
          name: "audit_log_config",
          ok: false,
          error: "AUDIT_LOG_CONFIG_INVALID",
        }),
      ])
    );
  });

  test("ops route requires the cron secret and exposes runtime config", async () => {
    const { GET } = await import("../src/app/api/internal/ops/route");

    const unauthorized = await GET(new Request("http://localhost/api/internal/ops"));
    expect(unauthorized.status).toBe(401);

    state.queryRaw.mockResolvedValueOnce([{ 1: 1 }]);

    const authorized = await GET(
      new Request("http://localhost/api/internal/ops", {
        headers: { "x-cron-secret": "test-secret" },
      })
    );
    const body = await authorized.json();

    expect(authorized.status).toBe(200);
    expect(body.runtime).toMatchObject({
      nodeEnv: "test",
      cronSecretConfigured: true,
      auditLogPurgeSchedulerEnabled: false,
    });
    expect(body.auditLog).toMatchObject({
      retentionEnabled: false,
      metricsEnabled: false,
    });
  });

  test("ops route returns 503 when runtime checks are not ready", async () => {
    state.queryRaw.mockRejectedValueOnce(new Error("db down"));

    const { GET } = await import("../src/app/api/internal/ops/route");
    const res = await GET(
      new Request("http://localhost/api/internal/ops", {
        headers: { "x-cron-secret": "test-secret" },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "database", ok: false }),
      ])
    );
  });

  test("getOpsStatus returns ready config and scheduler state when audit config loads", async () => {
    state.queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    state.loadAuditLogOpsConfig.mockReturnValue({
      retention: {
        enabled: true,
        days: 30,
        batchSize: 250,
        batchDelayMs: 25,
        maxRuntimeMinutes: 15,
        dryRun: true,
      },
      metrics: {
        enabled: true,
        actionTypesWhitelist: ["CREATE", "UPDATE"],
      },
    });
    process.env.AUDIT_LOG_PURGE_INTERVAL_MS = "60000";
    process.env.CRON_SECRET = "runtime-secret";

    const { getOpsStatus } = await importFresh<typeof import("../src/lib/internal-runtime")>(
      "../src/lib/internal-runtime"
    );
    const status = await getOpsStatus();

    expect(status.status).toBe("ready");
    expect(status.runtime).toEqual(
      expect.objectContaining({
        cronSecretConfigured: true,
        auditLogPurgeSchedulerEnabled: true,
      })
    );
    expect(status.auditLog).toMatchObject({
      ok: true,
      retentionEnabled: true,
      retentionDays: 30,
      retentionBatchSize: 250,
      retentionBatchDelayMs: 25,
      retentionMaxRuntimeMinutes: 15,
      retentionDryRun: true,
      metricsEnabled: true,
      metricsActionTypesWhitelist: ["CREATE", "UPDATE"],
    });
  });

  test("getOpsStatus falls back when audit config throws an Error", async () => {
    state.queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    state.loadAuditLogOpsConfig.mockImplementation(() => {
      throw new Error("audit config broken");
    });

    const { getOpsStatus } = await importFresh<typeof import("../src/lib/internal-runtime")>(
      "../src/lib/internal-runtime"
    );
    const status = await getOpsStatus();

    expect(status.status).toBe("not_ready");
    expect(status.auditLog).toEqual(
      expect.objectContaining({
        ok: false,
        error: "audit config broken",
      })
    );
  });

  test("getOpsStatus falls back when audit config throws a non-Error", async () => {
    state.queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    state.loadAuditLogOpsConfig.mockImplementation(() => {
      throw "bad config";
    });

    const { getOpsStatus } = await importFresh<typeof import("../src/lib/internal-runtime")>(
      "../src/lib/internal-runtime"
    );
    const status = await getOpsStatus();

    expect(status.status).toBe("not_ready");
    expect(status.auditLog).toEqual(
      expect.objectContaining({
        ok: false,
        error: "AUDIT_LOG_CONFIG_INVALID",
      })
    );
  });

  test("metrics route requires the cron secret and serves Prometheus text", async () => {
    const { GET } = await import("../src/app/api/internal/metrics/route");
    const { metricsRegistry: runtimeMetricsRegistry } = await import("@/lib/metrics");

    const unauthorized = await GET(new Request("http://localhost/api/internal/metrics"));
    expect(unauthorized.status).toBe(401);

    process.env.CRON_SECRET = "metrics-secret";
    runtimeMetricsRegistry.resetForTests();
    const counter = runtimeMetricsRegistry.counter("internal_runtime_requests_total", "Internal runtime requests");
    runtimeMetricsRegistry.incCounter(counter, undefined, 2);

    const authorized = await GET(
      new Request("http://localhost/api/internal/metrics", {
        headers: { "x-cron-secret": "metrics-secret" },
      })
    );
    const body = await authorized.text();

    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("content-type")).toContain("text/plain");
    expect(authorized.headers.get("cache-control")).toBe("no-store");
    expect(authorized.headers.get("pragma")).toBe("no-cache");
    expect(body).toContain("# TYPE internal_runtime_requests_total counter");
    expect(body).toContain("internal_runtime_requests_total 2");
  });

  test("env module accepts a coherent configuration", async () => {
    const { env } = await importFresh<typeof import("../src/lib/env")>("../src/lib/env");

    expect(env.NEXTAUTH_URL).toBe("https://app.example");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://app.example");
    expect(env.NODE_ENV).toBe("test");
  });

  test("env module surfaces detailed validation errors for partial SSO and secret mismatches", async () => {
    applyEnv({
      NODE_ENV: "production",
      AUTH_BYPASS: "1",
      AUTH_SECRET: "auth-secret",
      NEXTAUTH_SECRET: "different-secret",
      NEXTAUTH_URL: "https://app.example",
      NEXT_PUBLIC_APP_URL: "https://other.example",
      APP_URL: "https://other-app.example",
      TELEGRAM_LOGIN_BOT_NAME: "bot-a",
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: "bot-b",
      SSO_ISSUER: "https://issuer.example",
      SSO_CLIENT_ID: "sso-client",
    });

    let error: unknown;
    try {
      await importFresh<typeof import("../src/lib/env")>("../src/lib/env");
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Invalid environment configuration:");
    expect((error as Error).message).toContain(
      "NEXTAUTH_SECRET: NEXTAUTH_SECRET must match AUTH_SECRET when both are set"
    );
    expect((error as Error).message).toContain("APP_URL: APP_URL must match NEXTAUTH_URL");
    expect((error as Error).message).toContain(
      "NEXT_PUBLIC_APP_URL: NEXT_PUBLIC_APP_URL must match NEXTAUTH_URL"
    );
    expect((error as Error).message).toContain(
      "SSO_CLIENT_SECRET: SSO_CLIENT_SECRET must be set together with the other SSO_* values"
    );
    expect((error as Error).message).toContain(
      "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME must match TELEGRAM_LOGIN_BOT_NAME"
    );
    expect((error as Error).message).toContain(
      "AUTH_BYPASS: AUTH_BYPASS must never be enabled in production"
    );
  });

  test("env module requires the full Telegram auth trio when any Telegram auth value is set", async () => {
    applyEnv({
      TELEGRAM_BOT_TOKEN: "telegram-token",
      NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED: "1",
    });

    let error: unknown;
    try {
      await importFresh<typeof import("../src/lib/env")>("../src/lib/env");
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "TELEGRAM_LOGIN_BOT_NAME: TELEGRAM_LOGIN_BOT_NAME must be set together with the other Telegram auth values"
    );
    expect((error as Error).message).toContain(
      "NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME must be set together with the other Telegram auth values"
    );
  });

  test("env module ignores telegram placeholder values", async () => {
    applyEnv({
      TELEGRAM_BOT_TOKEN: "REPLACE_ME",
      TELEGRAM_LOGIN_BOT_NAME: undefined,
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: undefined,
    });

    const { env } = await importFresh<typeof import("../src/lib/env")>("../src/lib/env");

    expect(env.TELEGRAM_BOT_TOKEN).toBe("REPLACE_ME");
  });

  test("env module allows bot-only telegram setup when web auth is not enabled", async () => {
    applyEnv({
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_LOGIN_BOT_NAME: undefined,
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: undefined,
      NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED: "0",
    });

    const { env } = await importFresh<typeof import("../src/lib/env")>("../src/lib/env");

    expect(env.TELEGRAM_BOT_TOKEN).toBe("telegram-token");
    expect(env.NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED).toBe("0");
  });
});
