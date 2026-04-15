import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  link: vi.fn((props: { children?: unknown }) => props.children),
  loginForm: vi.fn((props: { initialMode: string; initialError?: string }) =>
    `login:${props.initialMode}:${props.initialError ?? ""}`
  ),
  inviteAcceptanceCard: vi.fn((props: { token: string }) => `invite:${props.token}`),
  appShell: vi.fn((props: { title: string; subtitle?: string; children?: unknown }) => props.children),
  fetchModels: vi.fn(),
  prisma: {
    chat: {
      findFirst: vi.fn(),
    },
  },
  auth: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  authUi: {
    getAuthCapabilities: vi.fn(),
    describeAuthMethods: vi.fn(() => "auth-summary"),
    loadAuthEmailGuardrails: vi.fn(),
    resolveAuthMode: vi.fn(),
  },
}));

vi.mock("next/link", () => ({
  default: (props: { children?: unknown }) => mocks.link(props),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/components/auth/LoginForm", () => ({
  default: (props: { initialMode: string; initialError?: string }) => mocks.loginForm(props),
}));

vi.mock("@/components/org/InviteAcceptanceCard", () => ({
  default: (props: { token: string }) => mocks.inviteAcceptanceCard(props),
}));

vi.mock("@/components/layout/AppShell", () => ({
  default: (props: { title: string; subtitle?: string; children?: unknown }) => mocks.appShell(props),
}));

vi.mock("@/lib/auth-ui", () => ({
  getAuthCapabilities: mocks.authUi.getAuthCapabilities,
  describeAuthMethods: mocks.authUi.describeAuthMethods,
  loadAuthEmailGuardrails: mocks.authUi.loadAuthEmailGuardrails,
  resolveAuthMode: mocks.authUi.resolveAuthMode,
}));

vi.mock("@/lib/models", () => ({
  fetchModels: mocks.fetchModels,
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
  requirePageSession: async () => {
    const session = await mocks.auth();
    if (!session?.user?.id) {
      return mocks.redirect("/login?mode=signin");
    }
    return session;
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import LoginPage from "@/app/login/page";
import InviteAcceptPage from "@/app/invite/accept/page";
import ModelsPage from "@/app/models/page";
import SharePage from "@/app/share/[token]/page";

async function render(node: unknown) {
  return renderToStaticMarkup(node as never);
}

async function expectRedirect(promise: Promise<unknown>, url: string) {
  await expect(promise).rejects.toThrow(`NEXT_REDIRECT:${url}`);
}

describe("simple pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
        role: "USER",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("renders the login page and forwards auth state", async () => {
    mocks.authUi.getAuthCapabilities.mockReturnValue({
      email: true,
      sso: false,
      telegram: true,
      tempAccess: false,
    });
    mocks.authUi.loadAuthEmailGuardrails.mockReturnValue({
      blockedEntries: ["blocked.example"],
      suspiciousDomains: [],
    });
    mocks.authUi.resolveAuthMode.mockReturnValue("register");

    const html = await render(
      await LoginPage({
        searchParams: Promise.resolve({ error: "AccessDenied", mode: "register" }),
      })
    );

    expect(html).toContain("Один вход для чата, регистрации и управления организацией");
    expect(html).toContain("Открыть организацию");
    expect(html).toContain("На главную");
    expect(html).toContain("login:register:AccessDenied");
    expect(mocks.authUi.resolveAuthMode).toHaveBeenCalledWith("register");
    expect(mocks.authUi.getAuthCapabilities).toHaveBeenCalledTimes(1);
    expect(mocks.authUi.loadAuthEmailGuardrails).toHaveBeenCalledTimes(1);
    expect(mocks.loginForm).toHaveBeenCalledWith({
      initialMode: "register",
      initialError: "AccessDenied",
      capabilities: {
        email: true,
        sso: false,
        telegram: true,
        tempAccess: false,
      },
      emailGuardrails: {
        blockedEntries: ["blocked.example"],
        suspiciousDomains: [],
      },
    });
    expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ href: "/org" }));
    expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ href: "/" }));
  });

  test("renders the login page with default mode when search params are absent", async () => {
    mocks.authUi.getAuthCapabilities.mockReturnValue({
      email: false,
      sso: true,
      telegram: false,
      tempAccess: false,
    });
    mocks.authUi.loadAuthEmailGuardrails.mockReturnValue({
      blockedEntries: [],
      suspiciousDomains: [],
    });
    mocks.authUi.resolveAuthMode.mockReturnValue("signin");

    const html = await render(await LoginPage({}));

    expect(html).toContain("login:signin:");
    expect(mocks.authUi.resolveAuthMode).toHaveBeenCalledWith(undefined);
    expect(mocks.loginForm).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMode: "signin",
        initialError: undefined,
      })
    );
  });

  test("renders the invite acceptance page and forwards the token", async () => {
    const html = await render(
      await InviteAcceptPage({
        searchParams: Promise.resolve({ token: "invite-token-123" }),
      })
    );

    expect(html).toContain("Примите приглашение и сразу попадите в рабочее пространство");
    expect(html).toContain("invite:invite-token-123");
    expect(mocks.inviteAcceptanceCard).toHaveBeenCalledWith({
      token: "invite-token-123",
    });
    expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ href: "/login?mode=signin" }));
    expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ href: "/org" }));
  });

  test("renders the invite acceptance page with an empty token when search params are missing", async () => {
    const html = await render(await InviteAcceptPage({}));

    expect(html).toContain("invite:");
    expect(mocks.inviteAcceptanceCard).toHaveBeenCalledWith({ token: "" });
  });

  test("renders the models page with fetched data", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "models@example.com",
        role: "USER",
      },
    });
    mocks.fetchModels.mockResolvedValue([
      {
        id: "openai/gpt-4o-mini",
        name: "GPT-4o mini",
        pricing: { prompt: "0.15", completion: "0.60" },
      },
      {
        id: "anthropic/claude-3-opus",
        name: "Claude 3 Opus",
      },
    ]);

    const html = await render(await ModelsPage());

    expect(html).toContain("GPT-4o mini");
    expect(html).toContain("openai/gpt-4o-mini");
    expect(html).toContain("Prompt: 0.15");
    expect(html).toContain("Completion: 0.60");
    expect(html).toContain("Claude 3 Opus");
    expect(html).toContain("Prompt: —");
    expect(html).toContain("Completion: —");
    expect(mocks.fetchModels).toHaveBeenCalledWith();
    expect(mocks.appShell).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Модели",
        subtitle: "Список моделей OpenRouter и базовые цены.",
      })
    );
  });

  test("renders the models page error state when fetch fails", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "models@example.com",
        role: "USER",
      },
    });
    mocks.fetchModels.mockRejectedValue(new Error("OpenRouter offline"));

    const html = await render(await ModelsPage());

    expect(html).toContain("OpenRouter offline");
    expect(html).not.toContain("GPT-4o mini");
  });

  test("renders the generic models page error when fetch rejects with a non-error", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "models@example.com",
        role: "USER",
      },
    });
    mocks.fetchModels.mockRejectedValue("timeout");

    const html = await render(await ModelsPage());

    expect(html).toContain("Не удалось загрузить модели.");
  });

  test("redirects the models page to login without session", async () => {
    mocks.auth.mockResolvedValue(null);

    await expectRedirect(ModelsPage(), "/login?mode=signin");
  });

  test("renders the shared chat page when chat exists", async () => {
    mocks.prisma.chat.findFirst.mockResolvedValue({
      title: "Shared chat",
      modelId: "openai/gpt-4o-mini",
      messages: [
        { id: "m-1", role: "USER", content: "Hello" },
        { id: "m-2", role: "ASSISTANT", content: "Hi there" },
      ],
    });

    const html = await render(
      await SharePage({
        params: Promise.resolve({ token: "share-token-1" }),
      })
    );

    expect(html).toContain("Shared chat");
    expect(html).toContain("Модель: openai/gpt-4o-mini");
    expect(html).toContain("Hello");
    expect(html).toContain("Hi there");
    expect(html).toContain("justify-end");
    expect(html).toContain("justify-start");
    expect(mocks.prisma.chat.findFirst).toHaveBeenCalledWith({
      where: { shareToken: "share-token-1" },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
  });

  test("renders the shared chat not-found state", async () => {
    mocks.prisma.chat.findFirst.mockResolvedValue(null);

    const html = await render(
      await SharePage({
        params: Promise.resolve({ token: "missing-token" }),
      })
    );

    expect(html).toContain("Ссылка недоступна");
    expect(html).toContain("Чат не найден или доступ закрыт.");
  });
});
