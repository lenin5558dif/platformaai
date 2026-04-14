// @vitest-environment jsdom

import React from "react";
import ReactDOMClient from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import SessionSecurityCard from "@/components/profile/SessionSecurityCard";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("SessionSecurityCard", () => {
  let container: HTMLDivElement;
  let root: ReactDOMClient.Root;
  let originalLocation: Location;
  const originalFetch = globalThis.fetch;
  const assign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);
    originalLocation = window.location;

    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  test("redirects to login after successful revoke", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await act(async () => {
      root.render(React.createElement(SessionSecurityCard));
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Завершить все мои сессии");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/revoke-all", {
      method: "POST",
    });
    expect(assign).toHaveBeenCalledWith("/login?mode=signin");
  });

  test("shows an error when revoke fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 500 }));

    await act(async () => {
      root.render(React.createElement(SessionSecurityCard));
    });

    const button = container.querySelector("button");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(assign).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Не удалось завершить активные сессии. Попробуйте снова."
    );
  });
});
