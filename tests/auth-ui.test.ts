import { describe, expect, it } from "vitest";
import {
  getAuthCapabilities,
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
      NEXT_PUBLIC_SSO_ENABLED: "1",
      NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME: "platforma_bot",
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

  it("maps verification errors to expired state", () => {
    const mapped = mapLoginError("Verification");
    expect(mapped?.state).toBe("expired");
    expect(mapped?.action).toBe("retry");
  });

  it("maps sso requirement and unknown errors safely", () => {
    const ssoRequired = mapLoginError("SSORequired");
    const unknown = mapLoginError("SomethingElse");

    expect(ssoRequired?.action).toBe("use_sso");
    expect(unknown?.state).toBe("error");
    expect(unknown?.action).toBe("retry");
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
