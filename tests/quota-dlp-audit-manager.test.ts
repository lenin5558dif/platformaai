// @vitest-environment jsdom

import React from "react";
import ReactDOMClient from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import QuotaDlpAuditManager from "@/components/org/QuotaDlpAuditManager";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("QuotaDlpAuditManager", () => {
  let container: HTMLDivElement;
  let root: ReactDOMClient.Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
  });

  test("loads and updates a cost center budget through the governance UI", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET" && url === "/api/org/cost-centers/cc-1/budget") {
        return new Response(JSON.stringify({ data: { budget: 80, spent: 20 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "PATCH" && url === "/api/org/cost-centers/cc-1/budget") {
        expect(JSON.parse(String(init?.body))).toEqual({ budget: null });
        return new Response(JSON.stringify({ data: { budget: 0, spent: 20 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    await act(async () => {
      root.render(
        React.createElement(QuotaDlpAuditManager, {
          actorPermissionKeys: [ORG_PERMISSIONS.ORG_LIMITS_MANAGE],
          orgBudget: 1000,
          orgSpent: 250,
          members: [],
          costCenters: [{ id: "cc-1", name: "Engineering" }],
          initialDlpPolicy: { enabled: true, action: "redact", patterns: [] },
          initialModelPolicy: { mode: "allowlist", models: [] },
        })
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Engineering");
    expect(container.textContent).toContain("20.00 / 80.00");

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Budget for Engineering"]');
    expect(input).toBeTruthy();

    await act(async () => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeValueSetter?.call(input!, "");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(input!.value).toBe("");

    const button = Array.from(container.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("Обновить бюджет")
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/org/cost-centers/cc-1/budget", {
      cache: "no-store",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/org/cost-centers/cc-1/budget", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ budget: null }),
    });
    expect(container.textContent).toContain("Бюджет cost center обновлен");
    expect(container.textContent).toContain("20.00 / 0.00");
  });
});
