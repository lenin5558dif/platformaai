import { describe, expect, it } from "vitest";
import {
  getAdminApiGroups,
  getAdminServiceSnapshots,
} from "@/lib/admin-dashboard";

describe("admin-dashboard service snapshots", () => {
  it("marks service as ready when all required env variables are present", () => {
    const snapshots = getAdminServiceSnapshots({
      OPENROUTER_API_KEY: "or-key",
      STRIPE_SECRET_KEY: "stripe-key",
      STRIPE_WEBHOOK_SECRET: "whsec",
    });

    const openrouter = snapshots.find((item) => item.id === "openrouter");
    const stripe = snapshots.find((item) => item.id === "stripe");

    expect(openrouter?.status).toBe("ready");
    expect(stripe?.status).toBe("ready");
    expect(stripe?.missingRequired).toEqual([]);
  });

  it("marks service as partial when only part of required env is present", () => {
    const snapshots = getAdminServiceSnapshots({
      STRIPE_SECRET_KEY: "stripe-key",
    });

    const stripe = snapshots.find((item) => item.id === "stripe");
    expect(stripe?.status).toBe("partial");
    expect(stripe?.missingRequired).toContain("STRIPE_WEBHOOK_SECRET");
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
