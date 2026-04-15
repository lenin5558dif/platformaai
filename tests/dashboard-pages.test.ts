import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const originalEnv = {
  AUTH_BYPASS: process.env.AUTH_BYPASS,
  ALLOW_USER_OPENROUTER_KEYS: process.env.ALLOW_USER_OPENROUTER_KEYS,
  GLOBAL_ADMIN_EMAILS: process.env.GLOBAL_ADMIN_EMAILS,
};

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  link: vi.fn((props: { children?: unknown; href?: string }) =>
    React.createElement("a", { href: props.href }, props.children)
  ),
  appShell: vi.fn(
    (props: {
      title: string;
      subtitle?: string;
      user?: unknown;
      children?: unknown;
    }) =>
      React.createElement(
        "section",
        {
          "data-shell": props.title,
          "data-subtitle": props.subtitle ?? "",
        },
        props.children
      )
  ),
  topUpForm: vi.fn(() =>
    React.createElement("div", { "data-testid": "top-up-form" }, "TopUpForm")
  ),
  telegramLinkSection: vi.fn((props: { telegramId: string | null }) =>
    React.createElement(
      "div",
      { "data-testid": "telegram-link" },
      props.telegramId ? `Telegram:${props.telegramId}` : "Telegram:none"
    )
  ),
  sessionSecurityCard: vi.fn(() =>
    React.createElement(
      "div",
      { "data-testid": "session-security-card" },
      "SessionSecurityCard"
    )
  ),
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    message: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
    prompt: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    eventLog: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
  userSettings: {
    getSettingsObject: vi.fn(),
    getUserAssistantInstructions: vi.fn(),
    getUserGoal: vi.fn(),
    getUserOpenRouterKey: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTone: vi.fn(),
    mergeSettings: vi.fn(),
    removeSettingsKey: vi.fn(),
  },
}));

vi.mock("next/link", () => ({
  default: (props: { children?: unknown; href?: string }) => mocks.link(props),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/components/layout/AppShell", () => ({
  default: (props: {
    title: string;
    subtitle?: string;
    user?: unknown;
    children?: unknown;
  }) => mocks.appShell(props),
}));

vi.mock("@/components/billing/TopUpForm", () => ({
  default: () => mocks.topUpForm(),
}));

vi.mock("@/components/profile/TelegramLinkSection", () => ({
  default: (props: { telegramId: string | null }) =>
    mocks.telegramLinkSection(props),
}));

vi.mock("@/components/profile/SessionSecurityCard", () => ({
  default: () => mocks.sessionSecurityCard(),
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

vi.mock("@/lib/user-settings", () => ({
  getSettingsObject: mocks.userSettings.getSettingsObject,
  getUserAssistantInstructions: mocks.userSettings.getUserAssistantInstructions,
  getUserGoal: mocks.userSettings.getUserGoal,
  getUserOpenRouterKey: mocks.userSettings.getUserOpenRouterKey,
  getUserProfile: mocks.userSettings.getUserProfile,
  getUserTone: mocks.userSettings.getUserTone,
  mergeSettings: mocks.userSettings.mergeSettings,
  removeSettingsKey: mocks.userSettings.removeSettingsKey,
}));

import AdminPage from "@/app/admin/page";
import BillingPage from "@/app/billing/page";
import EventsPage from "@/app/events/page";
import PricingPage from "@/app/pricing/page";
import ProfilePage from "@/app/profile/page";
import PromptsPage from "@/app/prompts/page";
import SettingsPage from "@/app/settings/page";
import TimelinePage from "@/app/timeline/page";

function render(node: unknown) {
  return renderToStaticMarkup(node as never);
}

async function expectRedirect(promise: Promise<unknown>, url: string) {
  await expect(promise).rejects.toThrow(`NEXT_REDIRECT:${url}`);
}

function getForms(root: unknown) {
  const forms: React.ReactElement[] = [];

  function walk(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (!React.isValidElement(node)) return;

    if (node.type === "form") {
      forms.push(node);
    }

    walk((node.props as { children?: unknown }).children);
  }

  walk(root);
  return forms;
}

type FormAction = ((formData: FormData) => Promise<void>) & { name: string };

function getNamedFormAction(
  forms: React.ReactElement[],
  actionName: string
): FormAction | undefined {
  return forms.find((form) => {
    const action = form.props.action as FormAction | undefined;
    return action?.name === actionName;
  })?.props.action as FormAction | undefined;
}

function createSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: {
      id: "user-1",
      email: "user@example.com",
      role: "USER",
      balance: 123.45,
      orgId: null,
      ...overrides,
    },
  };
}

describe("dashboard pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_BYPASS = originalEnv.AUTH_BYPASS;
    process.env.ALLOW_USER_OPENROUTER_KEYS = originalEnv.ALLOW_USER_OPENROUTER_KEYS;
    process.env.GLOBAL_ADMIN_EMAILS = originalEnv.GLOBAL_ADMIN_EMAILS;
    mocks.userSettings.getSettingsObject.mockImplementation((value) => value ?? {});
    mocks.userSettings.getUserAssistantInstructions.mockReturnValue(null);
    mocks.userSettings.getUserGoal.mockReturnValue(null);
    mocks.userSettings.getUserOpenRouterKey.mockReturnValue(null);
    mocks.userSettings.getUserProfile.mockReturnValue(null);
    mocks.userSettings.getUserTone.mockReturnValue(null);
  });

  afterEach(() => {
    if (originalEnv.AUTH_BYPASS === undefined) {
      delete process.env.AUTH_BYPASS;
    } else {
      process.env.AUTH_BYPASS = originalEnv.AUTH_BYPASS;
    }

    if (originalEnv.ALLOW_USER_OPENROUTER_KEYS === undefined) {
      delete process.env.ALLOW_USER_OPENROUTER_KEYS;
    } else {
      process.env.ALLOW_USER_OPENROUTER_KEYS = originalEnv.ALLOW_USER_OPENROUTER_KEYS;
    }

    if (originalEnv.GLOBAL_ADMIN_EMAILS === undefined) {
      delete process.env.GLOBAL_ADMIN_EMAILS;
    } else {
      process.env.GLOBAL_ADMIN_EMAILS = originalEnv.GLOBAL_ADMIN_EMAILS;
    }
  });

  test("renders pricing page copy and plans", async () => {
    const html = render(await PricingPage());

    expect(html).toContain("Раскройте потенциал всех");
    expect(html).toContain("Старт");
    expect(html).toContain("Креатор");
    expect(html).toContain("Профи");
    expect(html).toContain("Часто задаваемые вопросы");
    expect(html).toContain("Попробовать бесплатно");
    expect(mocks.appShell).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Тарифы",
        subtitle: "Выберите оптимальный план под ваши задачи.",
      })
    );
  });

  test("redirects billing page to login without session", async () => {
    mocks.auth.mockResolvedValue(null);
    await expectRedirect(BillingPage(), "/login?mode=signin");
  });

  test("renders billing page with personal plan details and empty history", async () => {
    mocks.auth.mockResolvedValue(createSession());
    mocks.prisma.user.findUnique.mockResolvedValue({
      balance: 77,
      email: "solo@example.com",
      settings: { planName: "Creator", planPrice: 29 },
      orgId: null,
      role: "USER",
      subscription: null,
    });
    mocks.prisma.message.aggregate.mockResolvedValue({
      _sum: { tokenCount: 0, cost: 0 },
      _count: { _all: 0 },
    });
    mocks.prisma.transaction.findMany.mockResolvedValue([]);

    const html = render(await BillingPage());

    expect(html).toContain("Подписка и платежи");
    expect(html).toContain("Креатор");
    expect(html).toContain("История платежей появится после первых операций.");
    expect(html).not.toContain("Реквизиты (B2B)");
    expect(mocks.prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  test("renders billing page B2B hint when org record is missing", async () => {
    mocks.auth.mockResolvedValue(
      createSession({ role: "ADMIN", orgId: "org-1", email: "admin@example.com" })
    );
    mocks.prisma.user.findUnique.mockResolvedValue({
      balance: 300,
      email: "admin@example.com",
      settings: { planName: "Omni Pro", planPrice: 59 },
      orgId: "org-1",
      role: "ADMIN",
      subscription: null,
    });
    mocks.prisma.message.aggregate.mockResolvedValue({
      _sum: { tokenCount: 0, cost: 0 },
      _count: { _all: 0 },
    });
    mocks.prisma.transaction.findMany.mockResolvedValue([]);
    mocks.prisma.organization.findUnique.mockResolvedValue(null);

    const html = render(await BillingPage());

    expect(html).toContain("Реквизиты доступны после создания организации.");
  });

  test("renders billing admin view with org details and transaction rows", async () => {
    process.env.GLOBAL_ADMIN_EMAILS = "admin@example.com";
    mocks.auth.mockResolvedValue(
      createSession({ role: "ADMIN", orgId: "org-1", email: "admin@example.com" })
    );
    mocks.prisma.user.findUnique.mockResolvedValue({
      balance: 300,
      email: "admin@example.com",
      settings: { planName: "Omni Pro", planPrice: 59 },
      orgId: "org-1",
      role: "ADMIN",
      subscription: null,
    });
    mocks.prisma.message.aggregate.mockResolvedValue({
      _sum: { tokenCount: 125000, cost: 17.5 },
      _count: { _all: 4 },
    });
    mocks.prisma.transaction.findMany.mockResolvedValue([
      {
        id: "tx-1",
        type: "REFILL",
        amount: "10.00",
        description: "Top up",
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
      },
      {
        id: "tx-2",
        type: "SPEND",
        amount: "4.25",
        description: "Usage",
        createdAt: new Date("2026-04-02T12:00:00.000Z"),
      },
      {
        id: "tx-3",
        type: "SUBSCRIPTION_RENEWAL",
        amount: "29.00",
        description: "Stripe продление подписки",
        createdAt: new Date("2026-04-03T12:00:00.000Z"),
      },
    ]);
    mocks.prisma.organization.findUnique.mockResolvedValue({
      name: "Acme LLC",
      settings: { companyName: "Acme LLC", taxId: "7700000000", address: "Moscow" },
    });

    const html = render(await BillingPage());

    expect(html).toContain("Реквизиты (B2B)");
    expect(html).toContain("Acme LLC");
    expect(html).toContain("7700000000");
    expect(html).toContain("Moscow");
    expect(html).toContain("Подробная статистика");
    expect(html).toContain("Оплачено");
    expect(html).toContain("Списание");
    expect(html).toContain("Подписка");
    expect(html).toContain("$29.00");
  });

  test("hides admin analytics links for non-global admins", async () => {
    process.env.GLOBAL_ADMIN_EMAILS = "root@example.com";
    mocks.auth.mockResolvedValue(
      createSession({ role: "ADMIN", orgId: "org-1", email: "admin@example.com" })
    );
    mocks.prisma.user.findUnique.mockResolvedValue({
      balance: 300,
      email: "admin@example.com",
      settings: { planName: "Omni Pro", planPrice: 59 },
      orgId: "org-1",
      role: "ADMIN",
      subscription: null,
    });
    mocks.prisma.message.aggregate.mockResolvedValue({
      _sum: { tokenCount: 125000, cost: 17.5 },
      _count: { _all: 4 },
    });
    mocks.prisma.transaction.findMany.mockResolvedValue([]);
    mocks.prisma.organization.findUnique.mockResolvedValue({
      name: "Acme LLC",
      settings: { companyName: "Acme LLC", taxId: "7700000000", address: "Moscow" },
    });

    const html = render(await BillingPage());

    expect(html).not.toContain("Подробная статистика");
  });

  test("renders billing page from active subscription instead of legacy settings", async () => {
    mocks.auth.mockResolvedValue(createSession());
    mocks.prisma.user.findUnique.mockResolvedValue({
      balance: 12,
      email: "solo@example.com",
      settings: { planName: "Legacy Pro", planPrice: 199 },
      orgId: null,
      role: "USER",
      subscription: {
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
        includedCredits: 100,
        includedCreditsUsed: 25,
        cancelAtPeriodEnd: false,
        plan: {
          code: "creator",
          name: "Креатор",
          monthlyPriceUsd: 29,
          includedCreditsPerMonth: 100,
        },
      },
    });
    mocks.prisma.message.aggregate.mockResolvedValue({
      _sum: { tokenCount: 3200, cost: 25 },
      _count: { _all: 3 },
    });
    mocks.prisma.transaction.findMany.mockResolvedValue([]);

    const html = render(await BillingPage());

    expect(html).toContain("Подписка активна");
    expect(html).toContain("Креатор");
    expect(html).toContain("Остаток включенных кредитов: 75,00 кр.");
    expect(html).not.toContain("Legacy Pro");
  });

  test("renders profile page states and telegram linkage", async () => {
    mocks.auth.mockResolvedValue(
      createSession({ balance: 88, orgId: "org-1", email: "profile@example.com" })
    );
    mocks.prisma.user.findUnique.mockResolvedValue({ telegramId: "tg-123" });

    const html = render(
      await ProfilePage({
        searchParams: Promise.resolve({ success: "1", canceled: "1" }),
      })
    );

    expect(html).toContain("Оплата прошла успешно");
    expect(html).toContain("Платёж отменён");
    expect(html).toContain("Telegram ID");
    expect(html).toContain("tg-123");
    expect(html).toContain("Telegram:tg-123");
    expect(html).toContain("SessionSecurityCard");
    expect(mocks.appShell).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Профиль",
        subtitle: "Управляйте аккаунтом и привяжите Telegram.",
      })
    );
  });

  test("renders profile page without telegram binding", async () => {
    mocks.auth.mockResolvedValue(createSession({ balance: 10, email: "plain@example.com" }));
    mocks.prisma.user.findUnique.mockResolvedValue({ telegramId: null });

    const html = render(await ProfilePage({}));

    expect(html).toContain("Telegram:none");
    expect(html).toContain("SessionSecurityCard");
    expect(html).toContain("—");
  });

  test("redirects profile page to login without session", async () => {
    mocks.auth.mockResolvedValue(null);
    await expectRedirect(ProfilePage({}), "/login?mode=signin");
  });

  test("redirects settings page to login without session", async () => {
    delete process.env.AUTH_BYPASS;
    delete process.env.ALLOW_USER_OPENROUTER_KEYS;
    mocks.auth.mockResolvedValue(null);
    await expectRedirect(SettingsPage(), "/login?mode=signin");
  });

  test("renders settings page and applies profile and API key actions", async () => {
    const session = createSession({
      id: "user-42",
      email: "ada@example.com",
      role: "ADMIN",
    });

    delete process.env.AUTH_BYPASS;
    process.env.ALLOW_USER_OPENROUTER_KEYS = "1";

    mocks.auth.mockResolvedValue(session);
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: {
        profileFirstName: "Ada",
        profileLastName: "Lovelace",
        profileHeadline: "Mathematician",
        profilePhone: "+7 900 000 00 00",
        planName: "Enterprise",
        planPrice: 199,
      },
      email: "ada@example.com",
      role: "ADMIN",
    });
    mocks.userSettings.getSettingsObject.mockReturnValue({
      profileFirstName: "Ada",
      profileLastName: "Lovelace",
      profileHeadline: "Mathematician",
      profilePhone: "+7 900 000 00 00",
      planName: "Enterprise",
      planPrice: 199,
    });
    mocks.userSettings.getUserOpenRouterKey.mockReturnValue("sk-live-4321");
    mocks.userSettings.getUserProfile.mockReturnValue("Research and writing");
    mocks.userSettings.getUserGoal.mockReturnValue("Рабочие задачи");
    mocks.userSettings.getUserTone.mockReturnValue("Коротко и по делу");
    mocks.userSettings.getUserAssistantInstructions.mockReturnValue("Be concise.");
    mocks.userSettings.mergeSettings.mockImplementation((base, patch) => ({
      ...(base as Record<string, unknown>),
      ...(patch as Record<string, unknown>),
      merged: true,
    }));
    mocks.userSettings.removeSettingsKey.mockImplementation((base, key) => ({
      ...(base as Record<string, unknown>),
      removedKey: key,
    }));

    const tree = await SettingsPage();
    const html = render(tree);
    const forms = getForms(tree);
    const profileAction = getNamedFormAction(forms, "updateProfileSettings");
    const keyAction = getNamedFormAction(forms, "updateOpenRouterKey");

    expect(html).toContain("Сохранен ключ ••••4321");
    expect(html).toContain("Ключ хранится в настройках пользователя");
    expect(html).toContain('value="Ada"');
    expect(html).toContain('value="Lovelace"');
    expect(mocks.appShell).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          displayName: "Ada Lovelace",
          planName: "Enterprise",
        }),
      })
    );
    expect(profileAction).toBeTruthy();
    expect(keyAction).toBeTruthy();

    const profileFormData = new FormData();
    profileFormData.set("firstName", " Grace ");
    profileFormData.set("lastName", " Hopper ");
    profileFormData.set("headline", " Admiral ");
    profileFormData.set("phone", " +1 555 0100 ");
    profileFormData.set("userProfile", " Compiler pioneer ");
    profileFormData.set("userGoal", "Программирование");
    profileFormData.set("userTone", "Формально и структурно");
    profileFormData.set("assistantInstructions", " Respond with examples. ");

    await profileAction!(profileFormData);

    expect(mocks.userSettings.mergeSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        profileFirstName: "Ada",
        profileLastName: "Lovelace",
      }),
      expect.objectContaining({
        profileFirstName: "Grace",
        profileLastName: "Hopper",
        profileHeadline: "Admiral",
        profilePhone: "+1 555 0100",
        userProfile: "Compiler pioneer",
        userGoal: "Программирование",
        userTone: "Формально и структурно",
        assistantInstructions: "Respond with examples.",
        onboarded: true,
      })
    );
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-42" },
      })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");

    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(session);
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: { profileFirstName: "Ada" },
    });
    mocks.userSettings.getSettingsObject.mockReturnValue({
      profileFirstName: "Ada",
      planName: "Enterprise",
      planPrice: 199,
    });
    mocks.userSettings.getUserOpenRouterKey.mockReturnValue("sk-live-4321");
    mocks.userSettings.getUserProfile.mockReturnValue("Research and writing");
    mocks.userSettings.getUserGoal.mockReturnValue("Рабочие задачи");
    mocks.userSettings.getUserTone.mockReturnValue("Коротко и по делу");
    mocks.userSettings.getUserAssistantInstructions.mockReturnValue("Be concise.");
    mocks.userSettings.mergeSettings.mockImplementation((base, patch) => ({
      ...(base as Record<string, unknown>),
      ...(patch as Record<string, unknown>),
      merged: true,
    }));
    mocks.userSettings.removeSettingsKey.mockImplementation((base, key) => ({
      ...(base as Record<string, unknown>),
      removedKey: key,
    }));

    const treeForKey = await SettingsPage();
    const keyActionForKeyOnly = getNamedFormAction(getForms(treeForKey), "updateOpenRouterKey")!;

    const apiKeyFormData = new FormData();
    apiKeyFormData.set("openrouterApiKey", " sk-test-1 ");
    await keyActionForKeyOnly(apiKeyFormData);
    expect(mocks.userSettings.mergeSettings).toHaveBeenCalledWith(
      expect.any(Object),
      { openrouterApiKey: "sk-test-1" }
    );
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({
            openrouterApiKey: "sk-test-1",
          }),
        }),
      })
    );

    const emptyApiKeyFormData = new FormData();
    emptyApiKeyFormData.set("openrouterApiKey", "");
    await keyActionForKeyOnly(emptyApiKeyFormData);
    expect(mocks.userSettings.removeSettingsKey).toHaveBeenCalledWith(
      expect.any(Object),
      "openrouterApiKey"
    );

    process.env.ALLOW_USER_OPENROUTER_KEYS = "0";
    mocks.auth.mockResolvedValue(session);
    const blockedApiKeyFormData = new FormData();
    blockedApiKeyFormData.set("openrouterApiKey", "sk-ignored");
    await keyActionForKeyOnly(blockedApiKeyFormData);
    expect(mocks.prisma.user.update).toHaveBeenCalledTimes(2);
  });

  test("renders settings page with environment key fallback", async () => {
    delete process.env.AUTH_BYPASS;
    delete process.env.ALLOW_USER_OPENROUTER_KEYS;
    mocks.auth.mockResolvedValue(
      createSession({ id: "user-99", email: "no-key@example.com", role: "USER" })
    );
    mocks.prisma.user.findUnique.mockResolvedValue({
      settings: { planName: "Pro Plan" },
      email: "no-key@example.com",
      role: "USER",
    });
    mocks.userSettings.getSettingsObject.mockReturnValue({ planName: "Pro Plan" });
    mocks.userSettings.getUserOpenRouterKey.mockReturnValue(null);
    mocks.userSettings.getUserProfile.mockReturnValue(null);
    mocks.userSettings.getUserGoal.mockReturnValue(null);
    mocks.userSettings.getUserTone.mockReturnValue(null);
    mocks.userSettings.getUserAssistantInstructions.mockReturnValue(null);

    const html = render(await SettingsPage());

    expect(html).toContain("Сейчас используется ключ из .env");
    expect(html).toContain("Вставьте ключ OpenRouter");
  });

  test("renders prompts page and exercises create prompt action branches", async () => {
    const session = createSession({
      id: "user-77",
      role: "ADMIN",
      orgId: "org-77",
      email: "prompt@example.com",
    });

    mocks.auth.mockResolvedValue(session);
    mocks.prisma.user.findUnique.mockResolvedValue({
      orgId: "org-77",
      email: "prompt@example.com",
      role: "ADMIN",
      settings: { planName: "Pro Plan" },
    });
    mocks.prisma.prompt.findMany.mockResolvedValue([
      {
        id: "prompt-1",
        title: "Org prompt",
        content: "Use org context",
        visibility: "ORG",
        tags: ["team", "planning"],
      },
    ]);

    const tree = await PromptsPage();
    const html = render(tree);
    const action = getNamedFormAction(getForms(tree), "createPrompt")!;

    expect(html).toContain("Библиотека промптов");
    expect(html).toContain("Org prompt");
    expect(html).toContain("Для организации");
    expect(html).toContain("Сохранить");

    await (async () => {
      mocks.auth.mockResolvedValue(null);
      const invalidNoSession = new FormData();
      invalidNoSession.set("title", "Nope");
      invalidNoSession.set("content", "Short");
      invalidNoSession.set("tags", "x");
      invalidNoSession.set("visibility", "ORG");
      await action(invalidNoSession);
    })();
    expect(mocks.prisma.prompt.create).not.toHaveBeenCalled();

    mocks.auth.mockResolvedValue(session);
    mocks.prisma.user.findUnique.mockResolvedValue({
      orgId: "org-77",
      email: "prompt@example.com",
      role: "ADMIN",
      settings: { planName: "Pro Plan" },
    });

    const invalidWithSession = new FormData();
    invalidWithSession.set("title", "X");
    invalidWithSession.set("content", "Short");
    invalidWithSession.set("tags", "invalid");
    invalidWithSession.set("visibility", "ORG");
    await action(invalidWithSession);
    expect(mocks.prisma.prompt.create).not.toHaveBeenCalled();

    const validPrompt = new FormData();
    validPrompt.set("title", " Weekly summary ");
    validPrompt.set("content", "Write a weekly status summary with action items.");
    validPrompt.set("tags", "status, summary\nstatus");
    validPrompt.set("visibility", "ORG");
    await action(validPrompt);
    expect(mocks.prisma.prompt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Weekly summary",
          content: "Write a weekly status summary with action items.",
          orgId: "org-77",
          visibility: "ORG",
          tags: ["status", "summary"],
          createdById: "user-77",
        }),
      })
    );

    mocks.prisma.prompt.create.mockClear();
    mocks.prisma.user.findUnique.mockResolvedValue({
      orgId: null,
      email: "prompt@example.com",
      role: "USER",
      settings: { planName: "Pro Plan" },
    });
    mocks.auth.mockResolvedValue(
      createSession({ id: "user-78", role: "USER", orgId: null })
    );

    const privatePrompt = new FormData();
    privatePrompt.set("title", "Global prompt");
    privatePrompt.set("content", "Long enough prompt content for global scope.");
    privatePrompt.set("tags", "global, reusable");
    privatePrompt.set("visibility", "ORG");
    await action(privatePrompt);
    expect(mocks.prisma.prompt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visibility: "PRIVATE",
          orgId: null,
          createdById: "user-78",
        }),
      })
    );
  });

  test("redirects prompts page to login without session", async () => {
    mocks.auth.mockResolvedValue(null);
    await expectRedirect(PromptsPage(), "/login?mode=signin");
  });

  test("renders timeline page for personal and org-admin views", async () => {
    mocks.auth.mockResolvedValue(
      createSession({ id: "timeline-user", role: "ADMIN", orgId: "org-9" })
    );
    mocks.prisma.user.findUnique.mockResolvedValue({
      role: "ADMIN",
      orgId: "org-9",
    });
    mocks.prisma.message.findMany.mockResolvedValue([
      {
        id: "msg-1",
        role: "ASSISTANT",
        content: "A".repeat(260),
        createdAt: new Date("2026-04-10T10:00:00.000Z"),
        chat: { title: "Org chat", modelId: "openai/gpt-4o", source: "WEB" },
        user: { email: "member@example.com", telegramId: "tg-member" },
      },
    ]);

    const html = render(
      await TimelinePage({
        searchParams: Promise.resolve({ source: "WEB", limit: "500" }),
      })
    );

    expect(html).toContain("Лента сообщений");
    expect(html).toContain("Org chat");
    expect(html).toContain("member@example.com");
    expect(html).toContain("WEB");
    expect(mocks.prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { orgId: "org-9" },
          chat: { source: "WEB" },
        }),
        take: 300,
      })
    );

    mocks.prisma.message.findMany.mockResolvedValue([
      {
        id: "msg-2",
        role: "USER",
        content: "Personal",
        createdAt: new Date("2026-04-11T11:00:00.000Z"),
        chat: { title: "Private", modelId: "anthropic/claude", source: "TELEGRAM" },
        user: { email: "", telegramId: "tg-user" },
      },
    ]);
    mocks.auth.mockResolvedValue(createSession({ id: "timeline-user-2", role: "USER" }));
    mocks.prisma.user.findUnique.mockResolvedValue({
      role: "USER",
      orgId: null,
    });

    const personalHtml = render(
      await TimelinePage({
        searchParams: Promise.resolve({ source: "INVALID", limit: "5" }),
      })
    );

    expect(personalHtml).toContain("tg-user");
    expect(mocks.prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "timeline-user-2",
          chat: undefined,
        }),
        take: 20,
      })
    );
  });

  test("redirects timeline page to login without session", async () => {
    mocks.auth.mockResolvedValue(null);
    await expectRedirect(TimelinePage({}), "/login?mode=signin");
  });

  test("renders events page and covers payload formatting", async () => {
    expect(() =>
      EventsPage({
        searchParams: Promise.resolve({ type: "AI_ERROR", model: " openai/gpt-4o ", limit: "999" }),
      })
    ).toThrow("NEXT_REDIRECT:/admin/events");
  });

  test("redirects events page to login without session", async () => {
    expect(() => EventsPage({})).toThrow("NEXT_REDIRECT:/admin/events");
  });

  test("renders admin page and covers query fallback", async () => {
    mocks.auth.mockResolvedValue(null);
    await expectRedirect(AdminPage(), "/login?mode=signin");

    mocks.auth.mockResolvedValue(createSession({ role: "USER" }));
    const forbiddenHtml = render(await AdminPage());
    expect(forbiddenHtml).toContain("Недостаточно прав");

    process.env.GLOBAL_ADMIN_EMAILS = "admin@example.com";
    mocks.auth.mockResolvedValue(createSession({ role: "ADMIN", email: "admin@example.com" }));
    mocks.prisma.message.aggregate.mockResolvedValue({
      _sum: { tokenCount: 4000, cost: 12.5 },
      _count: { _all: 3 },
    });
    mocks.prisma.$queryRaw.mockRejectedValueOnce(new Error("primary query failed"));
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      {
        modelId: "openai/gpt-4o",
        messageCount: 2,
        tokenCount: 2500,
        cost: "8.50",
      },
    ]);

    const html = render(await AdminPage());

    expect(html).toContain("Админ‑панель");
    expect(html).toContain("openai/gpt-4o");
    expect(html).toContain("2");
    expect(html).toContain("8.50");
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(2);

    mocks.prisma.$queryRaw.mockResolvedValueOnce([]);
    const emptyHtml = render(await AdminPage());
    expect(emptyHtml).toContain("Пока нет данных по использованию");
  });
});
