import { describe, expect, it } from "vitest";
import {
  evaluateAuthEmailGuardrails,
  getAuthCapabilities,
  loadAuthEmailGuardrails,
  getModeText,
  mapLoginError,
  resolveAuthMode,
} from "@/lib/auth-ui";

describe("auth-ui helpers", () => {
  it("resolves auth mode with signin fallback", () => {
    expect(resolveAuthMode("register")).toBe("register");
    expect(resolveAuthMode("signin")).toBe("signin");
    expect(resolveAuthMode("anything-else")).toBe("signin");
    expect(resolveAuthMode(undefined)).toBe("signin");
  });

  it("detects capabilities from env flags", () => {
    const capabilities = getAuthCapabilities({
      UNISENDER_API_KEY: "unisender-key",
      UNISENDER_SENDER_EMAIL: "no-reply@example.com",
      SSO_ISSUER: "https://issuer.example",
      SSO_CLIENT_ID: "id",
      SSO_CLIENT_SECRET: "secret",
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: "platforma_bot",
      TELEGRAM_LOGIN_BOT_NAME: "platforma_bot",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    });

    expect(capabilities).toEqual({
      email: true,
      sso: true,
      telegram: true,
    });
  });

  it("detects SSO by server-side provider settings", () => {
    const capabilities = getAuthCapabilities({
      SSO_ISSUER: "https://issuer.example",
      SSO_CLIENT_ID: "id",
      SSO_CLIENT_SECRET: "secret",
    });

    expect(capabilities.sso).toBe(true);
    expect(capabilities.telegram).toBe(false);
  });

  it("hides methods when their server configuration is incomplete", () => {
    const capabilities = getAuthCapabilities({
      UNISENDER_API_KEY: "unisender-key",
      NEXT_PUBLIC_SSO_ENABLED: "1",
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: "platforma_bot",
      TELEGRAM_LOGIN_BOT_NAME: "platforma_bot",
    });

    expect(capabilities).toEqual({
      email: false,
      sso: false,
      telegram: false,
    });
  });

  it("allows hiding SSO from the UI when server credentials are present", () => {
    const capabilities = getAuthCapabilities({
      SSO_ISSUER: "https://issuer.example",
      SSO_CLIENT_ID: "id",
      SSO_CLIENT_SECRET: "secret",
      NEXT_PUBLIC_SSO_ENABLED: "0",
    });

    expect(capabilities.sso).toBe(false);
  });

  it("maps verification errors to expired state", () => {
    const mapped = mapLoginError("Verification");
    expect(mapped?.state).toBe("expired");
    expect(mapped?.action).toBe("retry");
  });

  it("maps email sign-in throttling to a retryable message", () => {
    const mapped = mapLoginError("EmailSignInError");
    expect(mapped?.state).toBe("error");
    expect(mapped?.action).toBe("retry");
    expect(mapped?.message).toContain("Подождите");
  });

  it("maps sso requirement and unknown errors safely", () => {
    const ssoRequired = mapLoginError("SSORequired");
    const unknown = mapLoginError("SomethingElse");
    const blocked = mapLoginError("EmailDomainBlocked");
    const disabled = mapLoginError("AccountDisabled");
    const empty = mapLoginError(undefined);

    expect(ssoRequired?.action).toBe("use_sso");
    expect(unknown?.state).toBe("error");
    expect(unknown?.action).toBe("retry");
    expect(blocked?.action).toBe("contact_admin");
    expect(disabled?.action).toBe("contact_admin");
    expect(disabled?.title).toContain("Аккаунт отключен");
    expect(empty).toBeNull();
  });

  it("loads and evaluates auth email guardrails", () => {
    const guardrails = loadAuthEmailGuardrails({
      AUTH_EMAIL_BLOCKLIST: " blocked.example , blocked@tenant.example ",
      AUTH_EMAIL_SUSPICIOUS_DOMAINS: " temp.example ",
    });

    expect(evaluateAuthEmailGuardrails("user@blocked.example", guardrails)).toEqual(
      expect.objectContaining({
        blocked: true,
        suspicious: false,
        domain: "blocked.example",
      })
    );
    expect(evaluateAuthEmailGuardrails("blocked@tenant.example", guardrails)).toEqual(
      expect.objectContaining({
        blocked: true,
        suspicious: false,
        domain: "tenant.example",
      })
    );
    expect(evaluateAuthEmailGuardrails("user@temp.example", guardrails)).toEqual(
      expect.objectContaining({
        blocked: false,
        suspicious: true,
        domain: "temp.example",
      })
    );
    expect(evaluateAuthEmailGuardrails("user@mail.temp.example", guardrails)).toEqual(
      expect.objectContaining({
        blocked: false,
        suspicious: false,
        domain: "mail.temp.example",
      })
    );
    expect(evaluateAuthEmailGuardrails("invalid-email", guardrails)).toEqual(
      expect.objectContaining({
        blocked: false,
        suspicious: false,
        domain: null,
      })
    );
  });

  it("supports suffix-based suspicious domains and empty guardrails", () => {
    const guardrails = loadAuthEmailGuardrails({});

    expect(guardrails).toEqual({
      blockedEntries: [],
      suspiciousDomains: [],
    });

    const suffixGuardrails = loadAuthEmailGuardrails({
      AUTH_EMAIL_SUSPICIOUS_DOMAINS: ".temp.example",
    });

    expect(evaluateAuthEmailGuardrails("user@mail.temp.example", suffixGuardrails)).toEqual(
      expect.objectContaining({
        suspicious: true,
        blocked: false,
        domain: "mail.temp.example",
      })
    );

    expect(mapLoginError("AccessDenied")?.action).toBe("contact_admin");
  });

  it("returns mode-specific copy", () => {
    const registerText = getModeText("register");
    const signinText = getModeText("signin");

    expect(registerText.title).toContain("Создание аккаунта");
    expect(registerText.subtitle).toContain("основным идентификатором");
    expect(signinText.title).toContain("Вход");
    expect(signinText.ssoAction).toContain("SSO");
  });
});
