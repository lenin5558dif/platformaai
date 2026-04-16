import { describe, expect, it } from "vitest";
import {
  getAdminApiGroups,
  getAdminServiceSnapshots,
} from "@/lib/admin-dashboard";

describe("admin-dashboard service snapshots", () => {
  it("marks service as ready when all required env variables are present", () => {
    const snapshots = getAdminServiceSnapshots({
      OPENROUTER_API_KEY: "or-key",
      YOOKASSA_SHOP_ID: "shop-id",
      YOOKASSA_SECRET_KEY: "secret-key",
      YOOKASSA_WEBHOOK_SECRET: "whsec",
    });

    const openrouter = snapshots.find((item) => item.id === "openrouter");
    const yookassa = snapshots.find((item) => item.id === "yookassa");

    expect(openrouter?.status).toBe("ready");
    expect(yookassa?.status).toBe("ready");
    expect(yookassa?.missingRequired).toEqual([]);
  });

  it("marks service as partial when only part of required env is present", () => {
    const snapshots = getAdminServiceSnapshots({
      YOOKASSA_SHOP_ID: "shop-id",
      YOOKASSA_SECRET_KEY: "secret-key",
    });

    const yookassa = snapshots.find((item) => item.id === "yookassa");
    expect(yookassa?.status).toBe("partial");
    expect(yookassa?.missingRequired).toContain("YOOKASSA_WEBHOOK_SECRET");
  });

  it("marks service as missing when required env variables are absent", () => {
    const snapshots = getAdminServiceSnapshots({});
    const openaiWhisper = snapshots.find((item) => item.id === "openai-whisper");

    expect(openaiWhisper?.status).toBe("missing");
    expect(openaiWhisper?.missingRequired).toEqual(["OPENAI_API_KEY"]);
  });

  it("keeps services without required env variables in ready state", () => {
    const snapshots = getAdminServiceSnapshots({});
    const scim = snapshots.find((item) => item.id === "scim");

    expect(scim?.status).toBe("ready");
    expect(scim?.requiredEnv).toEqual([]);
  });
});

describe("admin-dashboard api groups", () => {
  it("returns grouped endpoints for known services", () => {
    const groups = getAdminApiGroups();
    const telegram = groups.find((group) => group.serviceId === "telegram");

    expect(telegram).toBeDefined();
    expect(telegram?.endpoints.some((item) => item.path === "/api/telegram/token")).toBe(
      true
    );
    expect(telegram?.endpoints.some((item) => item.path === "/api/telegram/webhook")).toBe(
      true
    );
  });
});
