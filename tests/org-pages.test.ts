import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(),
  createAuthorizer: vi.fn(),
  revalidatePath: vi.fn(),
  logAudit: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    orgDomain: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    costCenter: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
    orgMembership: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    orgRole: {
      findMany: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
  ensureOrgSystemRolesAndPermissions: vi.fn(),
  scimTokenManager: vi.fn(() => React.createElement("div", null, "SCIM TOKENS")),
  inviteManager: vi.fn(() => React.createElement("div", null, "INVITES")),
  rbacManager: vi.fn(() => React.createElement("div", null, "RBAC")),
  quotaDlpAuditManager: vi.fn(() => React.createElement("div", null, "QUOTA")),
  link: vi.fn((props: { children?: unknown }) => props.children),
}));

vi.mock("next/link", () => ({
  default: (props: { children?: unknown }) => mocks.link(props),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/authorize", () => ({
  requireSession: mocks.requireSession,
  createAuthorizer: mocks.createAuthorizer,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/lib/org-rbac", () => ({
  ensureOrgSystemRolesAndPermissions: mocks.ensureOrgSystemRolesAndPermissions,
}));

vi.mock("@/components/org/ScimTokenManager", () => ({
  default: () => mocks.scimTokenManager(),
}));

vi.mock("@/components/org/InviteManager", () => ({
  default: () => mocks.inviteManager(),
}));

vi.mock("@/components/org/RbacManager", () => ({
  default: () => mocks.rbacManager(),
}));

vi.mock("@/components/org/QuotaDlpAuditManager", () => ({
  default: () => mocks.quotaDlpAuditManager(),
}));

import OrgPage from "@/app/org/page";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";

type ActionEntry = {
  name: string;
  action: (...args: any[]) => unknown;
};

function isElement(value: unknown): value is React.ReactElement {
  return Boolean(value) && typeof value === "object" && "props" in (value as Record<string, unknown>);
}

function collectActions(node: unknown, out: ActionEntry[] = []): ActionEntry[] {
  if (Array.isArray(node)) {
    for (const item of node) collectActions(item, out);
    return out;
  }

  if (!isElement(node)) return out;

  const element = node as React.ReactElement & { props: { children?: unknown; action?: unknown } };
  if (element.type === "form" && typeof element.props.action === "function") {
    out.push({
      name: element.props.action.name || "anonymous",
      action: element.props.action,
    });
  }

  collectActions(element.props.children, out);
  return out;
}

function findAction(actions: ActionEntry[], expected: string) {
  const action = actions.find((entry) => entry.name.includes(expected));
  expect(action, `Missing action containing "${expected}"`).toBeDefined();
  return action!.action;
}

function makeSession(role = "ADMIN") {
  return {
    user: {
      id: "user-1",
      orgId: "org-1",
      role,
    },
  };
}

function setAdminAuthorizer(permissionKeys: string[]) {
  mocks.createAuthorizer.mockReturnValue({
    requireOrgMembership: vi.fn(async () => ({
      orgId: "org-1",
      permissionKeys: new Set(permissionKeys),
    })),
    requireOrgPermission: vi.fn(async () => ({
      orgId: "org-1",
      permissionKeys: new Set(permissionKeys),
    })),
  });
}

function makeFormData(entries: Array<[string, string]>) {
  const formData = new FormData();
  for (const [key, value] of entries) {
    formData.append(key, value);
  }
  return formData;
}

function setCommonOrgData() {
  mocks.prisma.organization.findUnique.mockResolvedValue({
    id: "org-1",
    name: "Acme Org",
    budget: 1000,
    spent: 250,
    settings: {
      dlpPolicy: { enabled: true, action: "redact", patterns: ["secret"] },
      modelPolicy: { mode: "allowlist", models: ["openai/gpt-4o"] },
    },
  });

  mocks.prisma.orgDomain.findMany.mockResolvedValue([
    { id: "domain-1", domain: "acme.example", ssoOnly: true },
  ]);

  mocks.prisma.user.findMany.mockResolvedValue([
    {
      id: "user-admin",
      email: "admin@acme.example",
      telegramId: null,
      role: "ADMIN",
      balance: { toString: () => "125.00" },
      dailyLimit: null,
      monthlyLimit: null,
      dailySpent: 0,
      monthlySpent: 0,
      isActive: true,
      costCenterId: "cc-1",
    },
    {
      id: "user-employee",
      email: "member@acme.example",
      telegramId: null,
      role: "EMPLOYEE",
      balance: { toString: () => "12.50" },
      dailyLimit: { toString: () => "10" },
      monthlyLimit: { toString: () => "100" },
      dailySpent: 1,
      monthlySpent: 2,
      isActive: false,
      costCenterId: null,
    },
  ]);

  mocks.prisma.costCenter.findMany.mockResolvedValue([
    { id: "cc-1", name: "Engineering", code: "ENG" },
    { id: "cc-2", name: "Finance", code: null },
  ]);

  mocks.prisma.orgRole.findMany.mockResolvedValue([
    { id: "role-1", name: SYSTEM_ROLE_NAMES.ADMIN, isSystem: true, permissions: [] },
    { id: "role-2", name: SYSTEM_ROLE_NAMES.MEMBER, isSystem: true, permissions: [] },
  ]);

  mocks.prisma.message.findMany.mockResolvedValue([
    {
      cost: 5,
      userId: "user-admin",
      costCenterId: "cc-1",
      chat: { modelId: "openai/gpt-4o" },
      user: { email: "admin@acme.example", telegramId: null, costCenterId: "cc-1" },
    },
    {
      cost: 2,
      userId: "user-employee",
      costCenterId: null,
      chat: { modelId: "anthropic/claude" },
      user: { email: "member@acme.example", telegramId: null, costCenterId: null },
    },
  ]);

  mocks.prisma.$queryRaw.mockResolvedValue([
    { day: new Date("2026-04-01T00:00:00.000Z"), total: 3 },
    { day: new Date("2026-04-02T00:00:00.000Z"), total: 4 },
  ]);

  mocks.ensureOrgSystemRolesAndPermissions.mockResolvedValue({
    rolesByName: new Map([[SYSTEM_ROLE_NAMES.OWNER, { id: "role-owner" }]]),
  });
}

async function renderOrgPage() {
  return OrgPage();
}

describe("org page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "http://app.example";
    mocks.auth.mockResolvedValue(makeSession());
    mocks.requireSession.mockResolvedValue(makeSession());
    setAdminAuthorizer([
      ORG_PERMISSIONS.ORG_BILLING_MANAGE,
      ORG_PERMISSIONS.ORG_LIMITS_MANAGE,
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE,
      ORG_PERMISSIONS.ORG_SETTINGS_UPDATE,
      ORG_PERMISSIONS.ORG_USER_MANAGE,
      ORG_PERMISSIONS.ORG_AUDIT_READ,
      ORG_PERMISSIONS.ORG_POLICY_UPDATE,
      ORG_PERMISSIONS.ORG_INVITE_CREATE,
    ]);
  });

  test("renders onboarding when there is no authenticated session", async () => {
    mocks.auth.mockResolvedValue(null);

    const html = renderToStaticMarkup((await renderOrgPage()) as never);

    expect(html).toContain("Организация недоступна без входа");
    expect(html).toContain("Создать организацию");
  });

  test("renders the first-org onboarding screen when the user has no org yet", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ orgId: null, role: "USER" });
    mocks.ensureOrgSystemRolesAndPermissions.mockResolvedValue({
      rolesByName: new Map([[SYSTEM_ROLE_NAMES.OWNER, { id: "role-owner" }]]),
    });

    const tree = await renderOrgPage();
    const html = renderToStaticMarkup(tree as never);
    const actions = collectActions(tree);
    const createOrg = findAction(actions, "createOrganization");

    expect(html).toContain("Создайте первую организацию");
    expect(html).toContain("Создание организации");
    expect(createOrg).toBeTypeOf("function");
  });

  test("renders the org dashboard and exposes admin actions", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ orgId: "org-1", role: "ADMIN" });
    setCommonOrgData();

    const tree = await renderOrgPage();
    const html = renderToStaticMarkup(tree as never);
    const actions = collectActions(tree);

    expect(html).toContain("Acme Org");
    expect(html).toContain("SCIM endpoint: http://app.example/api/scim");
    expect(html).toContain("INVITES");
    expect(html).toContain("RBAC");
    expect(html).toContain("QUOTA");

    const updateBudget = findAction(actions, "updateBudget");
    const createCostCenter = findAction(actions, "createCostCenter");
    const deleteCostCenter = findAction(actions, "deleteCostCenter");
    const addSsoDomain = findAction(actions, "addSsoDomain");
    const updateSsoDomain = findAction(actions, "updateSsoDomain");
    const removeSsoDomain = findAction(actions, "removeSsoDomain");
    const assignCostCenter = findAction(actions, "assignCostCenter");
    const updateLimits = findAction(actions, "updateLimits");
    const transferCredits = findAction(actions, "transferCredits");
    const toggleUserActive = findAction(actions, "toggleUserActive");

    expect(updateBudget).toBeTypeOf("function");
    expect(createCostCenter).toBeTypeOf("function");
    expect(deleteCostCenter).toBeTypeOf("function");
    expect(addSsoDomain).toBeTypeOf("function");
    expect(updateSsoDomain).toBeTypeOf("function");
    expect(removeSsoDomain).toBeTypeOf("function");
    expect(assignCostCenter).toBeTypeOf("function");
    expect(updateLimits).toBeTypeOf("function");
    expect(transferCredits).toBeTypeOf("function");
    expect(toggleUserActive).toBeTypeOf("function");

    await updateBudget(makeFormData([["budget", "2000"]]));
    await createCostCenter(
      makeFormData([
        ["name", "Marketing"],
        ["code", "MKT"],
      ])
    );
    await deleteCostCenter(makeFormData([]));
    await addSsoDomain(
      makeFormData([
        ["domain", "acme.example"],
        ["ssoOnly", "true"],
      ])
    );
    await updateSsoDomain(makeFormData([["ssoOnly", "false"]]));
    await removeSsoDomain(makeFormData([]));
    mocks.prisma.costCenter.findFirst.mockResolvedValue({ id: "cc-2" });
    await assignCostCenter(
      makeFormData([
        ["costCenterId", "cc-2"],
      ])
    );
    await updateLimits(
      makeFormData([
        ["dailyLimit", "25"],
        ["monthlyLimit", "250"],
      ])
    );
    await toggleUserActive(makeFormData([["isActive", "false"]]));

    expect(mocks.prisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { budget: 2000 },
    });
    expect(mocks.prisma.costCenter.create).toHaveBeenCalledWith({
      data: {
        orgId: "org-1",
        name: "Marketing",
        code: "MKT",
      },
    });
    expect(mocks.prisma.orgDomain.upsert).toHaveBeenCalledWith({
      where: { domain: "acme.example" },
      update: { orgId: "org-1", ssoOnly: true },
      create: { orgId: "org-1", domain: "acme.example", ssoOnly: true },
    });
    expect(mocks.prisma.orgDomain.updateMany).toHaveBeenCalledWith({
      where: { id: "domain-1", orgId: "org-1" },
      data: { ssoOnly: false },
    });
    expect(mocks.prisma.orgDomain.deleteMany).toHaveBeenCalledWith({
      where: { id: "domain-1", orgId: "org-1" },
    });
    expect(mocks.prisma.orgMembership.updateMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", userId: "user-admin" },
      data: { defaultCostCenterId: "cc-2" },
    });
    expect(mocks.prisma.user.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "user-admin", orgId: "org-1" },
      data: { costCenterId: "cc-2" },
    });
    expect(mocks.prisma.user.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "user-admin", orgId: "org-1" },
      data: { dailyLimit: 25, monthlyLimit: 250 },
    });
    expect(mocks.prisma.user.updateMany).toHaveBeenNthCalledWith(3, {
      where: { id: "user-admin", orgId: "org-1" },
      data: { isActive: false },
    });
    expect(actions.length).toBeGreaterThanOrEqual(10);
  });

  test("renders empty org lists for domains and members", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ orgId: "org-1", role: "ADMIN" });
    setCommonOrgData();
    mocks.prisma.orgDomain.findMany.mockResolvedValue([]);
    mocks.prisma.user.findMany.mockResolvedValue([]);

    const html = renderToStaticMarkup((await renderOrgPage()) as never);

    expect(html).toContain("Домены еще не добавлены.");
    expect(html).toContain("Пока нет сотрудников");
  });

  test("renders empty cost center and usage states", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ orgId: "org-1", role: "ADMIN" });
    setCommonOrgData();
    mocks.prisma.costCenter.findMany.mockResolvedValue([]);
    mocks.prisma.message.findMany.mockResolvedValue([]);
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.prisma.$queryRaw.mockResolvedValue([]);

    const html = renderToStaticMarkup((await renderOrgPage()) as never);

    expect(html).toContain("Пока нет данных.");
    expect(html).toContain("Пока нет cost centers. Создайте первый.");
  });

  test("renders zero-width analytics bars for zero-cost activity", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ orgId: "org-1", role: "ADMIN" });
    setCommonOrgData();
    mocks.prisma.message.findMany.mockResolvedValue([
      {
        cost: 0,
        userId: "user-admin",
        costCenterId: "cc-1",
        chat: { modelId: "openai/gpt-4o" },
        user: { email: "admin@acme.example", telegramId: null, costCenterId: "cc-1" },
      },
      {
        cost: 0,
        userId: "user-employee",
        costCenterId: "cc-2",
        chat: { modelId: "anthropic/claude" },
        user: { email: "member@acme.example", telegramId: null, costCenterId: "cc-2" },
      },
    ]);
    mocks.prisma.costCenter.findMany.mockResolvedValue([
      { id: "cc-1", name: "Engineering", code: "ENG" },
      { id: "cc-2", name: "Finance", code: null },
    ]);
    mocks.prisma.$queryRaw.mockResolvedValue([]);

    const html = renderToStaticMarkup((await renderOrgPage()) as never);

    expect(html).toContain("openai/gpt-4o");
    expect(html).toContain("anthropic/claude");
    expect(html).toContain("Engineering");
    expect(html).toContain("Finance");
  });

  test("falls back when org permission lookup fails and remove domain action swallows errors", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ orgId: "org-1", role: "ADMIN" });
    setCommonOrgData();
    mocks.createAuthorizer.mockReturnValue({
      requireOrgMembership: vi.fn(async () => {
        throw new Error("membership lookup failed");
      }),
      requireOrgPermission: vi.fn(async () => {
        throw new Error("permission lookup failed");
      }),
    });

    const tree = await renderOrgPage();
    const html = renderToStaticMarkup(tree as never);
    const removeSsoDomain = findAction(collectActions(tree), "removeSsoDomain");

    expect(html).toContain("Acme Org");
    await expect(removeSsoDomain(makeFormData([]))).resolves.toBeUndefined();
  });

  test("renders the employee view without admin-only sections", async () => {
    mocks.auth.mockResolvedValue(makeSession("EMPLOYEE"));
    mocks.prisma.user.findUnique.mockResolvedValue({ orgId: "org-1", role: "EMPLOYEE" });
    setAdminAuthorizer([]);
    setCommonOrgData();

    const html = renderToStaticMarkup((await renderOrgPage()) as never);

    expect(html).toContain("Acme Org");
    expect(html).not.toContain("INVITES");
    expect(html).not.toContain("SSO и SCIM");
    expect(html).not.toContain("SCIM TOKENS");
  });
});
