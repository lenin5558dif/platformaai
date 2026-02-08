import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession } from "@/lib/authorize";
import { ORG_PERMISSIONS, SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";
import { ensureOrgSystemRolesAndPermissions } from "@/lib/org-rbac";
import {
  getOrgDlpPolicy,
  getOrgModelPolicy,
} from "@/lib/org-settings";
import ScimTokenManager from "@/components/org/ScimTokenManager";
import InviteManager from "@/components/org/InviteManager";
import RbacManager from "@/components/org/RbacManager";
import QuotaDlpAuditManager from "@/components/org/QuotaDlpAuditManager";

export const dynamic = "force-dynamic";

function parseOptionalNumber(value: FormDataEntryValue | null) {
  if (!value || typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

async function createOrganization(formData: FormData) {
  "use server";
  try {
    const session = await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const budgetValue = parseOptionalNumber(formData.get("budget"));

  if (name.length < 2) {
    return;
  }

    const existing = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { orgId: true },
    });

    if (existing?.orgId) {
      return;
    }

    const org = await prisma.organization.create({
      data: {
        name,
        ownerId: session.user.id,
        budget: budgetValue ?? 0,
      },
    });

    await prisma.user.update({
      where: { id: session.user.id },
      data: { orgId: org.id, role: "ADMIN" },
    });

    const { rolesByName } = await ensureOrgSystemRolesAndPermissions(org.id);
    const ownerRole = rolesByName.get(SYSTEM_ROLE_NAMES.OWNER);
    if (ownerRole) {
      await prisma.orgMembership.upsert({
        where: {
          orgId_userId: {
            orgId: org.id,
            userId: session.user.id,
          },
        },
        update: {
          roleId: ownerRole.id,
        },
        create: {
          orgId: org.id,
          userId: session.user.id,
          roleId: ownerRole.id,
        },
      });
    }

    await logAudit({
      action: "ORG_UPDATED",
      orgId: org.id,
      actorId: session.user.id,
      targetType: "organization",
      targetId: org.id,
      metadata: { created: true },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function updateBudget(formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_BILLING_MANAGE
    );

    const budgetValue = parseOptionalNumber(formData.get("budget"));
    if (budgetValue === null) {
      return;
    }

    await prisma.organization.update({
      where: { id: membership.orgId },
      data: { budget: budgetValue },
    });

    await logAudit({
      action: "ORG_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "organization",
      targetId: membership.orgId,
      metadata: { budget: budgetValue },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function updateLimits(userId: string, formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_LIMITS_MANAGE
    );

    const dailyLimit = parseOptionalNumber(formData.get("dailyLimit"));
    const monthlyLimit = parseOptionalNumber(formData.get("monthlyLimit"));

    await prisma.user.updateMany({
      where: { id: userId, orgId: membership.orgId },
      data: {
        dailyLimit: dailyLimit ?? undefined,
        monthlyLimit: monthlyLimit ?? undefined,
      },
    });

    await logAudit({
      action: "USER_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: userId,
      metadata: { dailyLimit, monthlyLimit },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function transferCredits(userId: string, formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_BILLING_MANAGE
    );

    const amount = parseOptionalNumber(formData.get("amount"));
    if (!amount || amount <= 0) {
      return;
    }

    const admin = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, balance: true, costCenterId: true },
    });

    if (!admin) {
      return;
    }

    if (Number(admin.balance) < amount) {
      return;
    }

    await prisma.$transaction(async (tx) => {
      const member = await tx.user.findFirst({
        where: { id: userId, orgId: membership.orgId },
        select: { id: true, costCenterId: true },
      });

      if (!member) {
        return;
      }

      await tx.user.update({
        where: { id: admin.id },
        data: { balance: { decrement: amount } },
      });

      await tx.user.update({
        where: { id: member.id },
        data: { balance: { increment: amount } },
      });

      await tx.transaction.create({
        data: {
          userId: admin.id,
          costCenterId: admin.costCenterId ?? undefined,
          amount,
          type: "SPEND",
          description: `Перевод сотруднику ${member.id}`,
        },
      });

      await tx.transaction.create({
        data: {
          userId: member.id,
          costCenterId: member.costCenterId ?? undefined,
          amount,
          type: "REFILL",
          description: "Пополнение от администратора",
        },
      });
    });

    await logAudit({
      action: "USER_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: userId,
      metadata: { transferAmount: amount },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function createCostCenter(formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE
    );

    const name = String(formData.get("name") ?? "").trim();
    const code = String(formData.get("code") ?? "").trim();

    if (!name) return;

    const costCenter = await prisma.costCenter.create({
      data: {
        orgId: membership.orgId,
        name,
        code: code || null,
      },
    });

    await logAudit({
      action: "COST_CENTER_CREATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "cost_center",
      targetId: costCenter.id,
      metadata: { name },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function deleteCostCenter(costCenterId: string) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE
    );

    await prisma.costCenter.deleteMany({
      where: { id: costCenterId, orgId: membership.orgId },
    });

    await logAudit({
      action: "COST_CENTER_DELETED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "cost_center",
      targetId: costCenterId,
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function assignCostCenter(userId: string, formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_COST_CENTER_MANAGE
    );

    const value = String(formData.get("costCenterId") ?? "").trim();
    let costCenterId: string | null = value.length ? value : null;

    if (costCenterId) {
      const exists = await prisma.costCenter.findFirst({
        where: { id: costCenterId, orgId: membership.orgId },
        select: { id: true },
      });
      if (!exists) {
        costCenterId = null;
      }
    }

    await prisma.user.updateMany({
      where: { id: userId, orgId: membership.orgId },
      data: { costCenterId },
    });

    await prisma.orgMembership.updateMany({
      where: { orgId: membership.orgId, userId },
      data: { defaultCostCenterId: costCenterId },
    });

    await logAudit({
      action: "COST_CENTER_ASSIGNED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: userId,
      metadata: { costCenterId },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function toggleUserActive(userId: string, formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_USER_MANAGE
    );

    const isActive = String(formData.get("isActive")) === "true";

    await prisma.user.updateMany({
      where: { id: userId, orgId: membership.orgId },
      data: { isActive },
    });

    await logAudit({
      action: isActive ? "USER_UPDATED" : "USER_DISABLED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "user",
      targetId: userId,
      metadata: { isActive },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function addSsoDomain(formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_SETTINGS_UPDATE
    );

    const rawDomain = String(formData.get("domain") ?? "").trim().toLowerCase();
    if (!rawDomain) return;
    const ssoOnly = String(formData.get("ssoOnly")) === "true";

    const domain = await prisma.orgDomain.upsert({
      where: { domain: rawDomain },
      update: { orgId: membership.orgId, ssoOnly },
      create: { orgId: membership.orgId, domain: rawDomain, ssoOnly },
    });

    await logAudit({
      action: "SSO_DOMAIN_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "domain",
      targetId: domain.id,
      metadata: { domain: rawDomain, ssoOnly },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function updateSsoDomain(domainId: string, formData: FormData) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_SETTINGS_UPDATE
    );

    const ssoOnly = String(formData.get("ssoOnly")) === "true";

    await prisma.orgDomain.updateMany({
      where: { id: domainId, orgId: membership.orgId },
      data: { ssoOnly },
    });

    await logAudit({
      action: "SSO_DOMAIN_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "domain",
      targetId: domainId,
      metadata: { ssoOnly },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

async function removeSsoDomain(domainId: string) {
  "use server";
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_SETTINGS_UPDATE
    );

    await prisma.orgDomain.deleteMany({
      where: { id: domainId, orgId: membership.orgId },
    });

    await logAudit({
      action: "SSO_DOMAIN_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "domain",
      targetId: domainId,
      metadata: { removed: true },
    });

    revalidatePath("/org");
  } catch {
    return;
  }
}

export default async function OrgPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Организация недоступна
          </h1>
          <p className="text-sm text-text-secondary">
            Пожалуйста, войдите в аккаунт.
          </p>
        </div>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, role: true },
  });

  if (!user?.orgId) {
    return (
      <div className="min-h-screen px-6 py-10">
        <div className="max-w-3xl mx-auto rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Создайте организацию
          </h1>
          <p className="text-sm text-text-secondary mb-6">
            Организация нужна для распределения бюджета и лимитов сотрудников.
          </p>
          <form action={createOrganization} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-main">
                Название
              </label>
              <input
                name="name"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                placeholder="PlatformaAI"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-main">
                Бюджет (кредиты)
              </label>
              <input
                name="budget"
                type="number"
                step="0.01"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                placeholder="1000"
              />
            </div>
            <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
              Создать
            </button>
          </form>
        </div>
      </div>
    );
  }

  const authorizer = createAuthorizer(session);
  let actorPermissionKeys: string[] = [];
  try {
    const membership = await authorizer.requireOrgMembership(user.orgId);
    actorPermissionKeys = Array.from(membership.permissionKeys);
  } catch {
    actorPermissionKeys = [];
  }

  const org = await prisma.organization.findUnique({
    where: { id: user.orgId },
  });

  const dlpPolicy = getOrgDlpPolicy(org?.settings ?? null);
  const modelPolicy = getOrgModelPolicy(org?.settings ?? null);

  const domains = await prisma.orgDomain.findMany({
    where: { orgId: user.orgId },
    orderBy: { domain: "asc" },
  });

  const members = await prisma.user.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "asc" },
  });

  const costCenters = await prisma.costCenter.findMany({
    where: { orgId: user.orgId },
    orderBy: { name: "asc" },
  });

  const orgRoles = await prisma.orgRole.findMany({
    where: { orgId: user.orgId },
    include: {
      permissions: {
        include: {
          permission: {
            select: { key: true },
          },
        },
      },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  const inviteRoles = orgRoles.map((role) => ({ id: role.id, name: role.name }));
  const canManageInvites = actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_INVITE_CREATE);

  const costCenterCounts = new Map<string, number>();
  for (const member of members) {
    const key = member.costCenterId ?? "unassigned";
    costCenterCounts.set(key, (costCenterCounts.get(key) ?? 0) + 1);
  }

  const usageMessages = await prisma.message.findMany({
    where: {
      role: "ASSISTANT",
      user: { orgId: user.orgId },
    },
    select: {
      cost: true,
      userId: true,
      costCenterId: true,
      chat: { select: { modelId: true } },
      user: { select: { email: true, telegramId: true, costCenterId: true } },
    },
  });

  const daysCount = 14;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - (daysCount - 1));
  startDate.setUTCHours(0, 0, 0, 0);

  const dailyRows = await prisma.$queryRaw<
    { day: Date; total: number }[]
  >`
    SELECT date_trunc('day', m."createdAt") AS day,
           COALESCE(SUM(m."cost"), 0) AS total
    FROM "Message" m
    JOIN "User" u ON u."id" = m."userId"
    WHERE u."orgId" = ${user.orgId}
      AND m."role" = 'ASSISTANT'
      AND m."createdAt" >= ${startDate}
    GROUP BY day
    ORDER BY day ASC
  `;

  const dailyMap = new Map<string, number>();
  for (const row of dailyRows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    dailyMap.set(key, Number(row.total ?? 0));
  }

  const modelTotals = new Map<string, number>();
  const userTotals = new Map<string, { label: string; total: number }>();
  const costCenterTotals = new Map<string, { label: string; total: number }>();
  const costCenterNameMap = new Map(
    costCenters.map((center) => [center.id, center.name])
  );

  for (const message of usageMessages) {
    const modelId = message.chat?.modelId ?? "unknown";
    const cost = Number(message.cost ?? 0);
    modelTotals.set(modelId, (modelTotals.get(modelId) ?? 0) + cost);

    const label = message.user?.email ?? message.user?.telegramId ?? message.userId;
    const current = userTotals.get(message.userId) ?? { label, total: 0 };
    current.total += cost;
    userTotals.set(message.userId, current);

    const costCenterId =
      message.costCenterId ?? message.user?.costCenterId ?? "unassigned";
    const costCenterLabel =
      costCenterId === "unassigned"
        ? "Без центра"
        : costCenterNameMap.get(costCenterId) ?? "Центр";
    const costCenterEntry =
      costCenterTotals.get(costCenterId) ?? { label: costCenterLabel, total: 0 };
    costCenterEntry.total += cost;
    costCenterTotals.set(costCenterId, costCenterEntry);
  }

  const topModels = Array.from(modelTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topUsers = Array.from(userTotals.entries())
    .map(([, value]) => value)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const topCostCenters = Array.from(costCenterTotals.entries())
    .map(([, value]) => value)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const maxModelTotal = topModels[0]?.[1] ?? 0;
  const maxUserTotal = topUsers[0]?.total ?? 0;
  const maxCostCenterTotal = topCostCenters[0]?.total ?? 0;

  const dailySeries = Array.from({ length: daysCount }, (_, index) => {
    const day = new Date(startDate);
    day.setUTCDate(startDate.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    return {
      label: day.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      }),
      total: dailyMap.get(key) ?? 0,
    };
  });
  const maxDailyTotal = Math.max(
    ...dailySeries.map((item) => item.total),
    1
  );

  const budget = Number(org?.budget ?? 0);
  const spent = Number(org?.spent ?? 0);
  const budgetProgress = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            {org?.name}
          </h1>
          <p className="text-sm text-text-secondary">
            Бюджет: {org?.budget.toString() ?? 0} кредитов • Потрачено: {org?.spent.toString() ?? 0}
          </p>
          {user.role === "ADMIN" && (
            <form action={updateBudget} className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-text-secondary">
                  Обновить бюджет
                </label>
                <input
                  name="budget"
                  type="number"
                  step="0.01"
                  className="mt-2 w-48 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                  placeholder="1500"
                />
              </div>
              <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                Сохранить
              </button>
            </form>
          )}
          <div className="mt-4">
            <div className="h-2 w-full rounded-full bg-gray-200">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${budgetProgress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              Использовано {budgetProgress.toFixed(1)}% бюджета
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
            Cost Analyzer
          </h2>
          <div className="mb-6">
            <p className="text-xs text-text-secondary mb-3">
              Расходы за последние 14 дней
            </p>
            <div className="flex items-end gap-2 h-28">
              {dailySeries.map((item) => {
                const height = Math.round((item.total / maxDailyTotal) * 80) + 6;
                return (
                  <div
                    key={item.label}
                    className="flex flex-col items-center gap-1 flex-1"
                  >
                    <div
                      className="w-3 rounded-t bg-primary/70"
                      style={{ height }}
                    />
                    <span className="text-[10px] text-text-secondary">
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="text-sm font-semibold text-text-main mb-3">
                Модели
              </h3>
              <div className="space-y-3">
                {topModels.length === 0 && (
                  <p className="text-xs text-text-secondary">
                    Пока нет данных.
                  </p>
                )}
                {topModels.map(([modelId, total]) => {
                  const width = maxModelTotal
                    ? Math.round((total / maxModelTotal) * 100)
                    : 0;
                  return (
                    <div key={modelId} className="space-y-1">
                      <div className="flex items-center justify-between text-sm text-text-main">
                        <span className="truncate">{modelId}</span>
                        <span className="text-xs text-text-secondary">
                          {total.toFixed(2)} кредитов
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-200">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-main mb-3">
                Пользователи
              </h3>
              <div className="space-y-3">
                {topUsers.length === 0 && (
                  <p className="text-xs text-text-secondary">
                    Пока нет данных.
                  </p>
                )}
                {topUsers.map((entry) => {
                  const width = maxUserTotal
                    ? Math.round((entry.total / maxUserTotal) * 100)
                    : 0;
                  return (
                    <div key={entry.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm text-text-main">
                        <span className="truncate">{entry.label}</span>
                        <span className="text-xs text-text-secondary">
                          {entry.total.toFixed(2)} кредитов
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-200">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-main mb-3">
                Cost centers
              </h3>
              <div className="space-y-3">
                {topCostCenters.length === 0 && (
                  <p className="text-xs text-text-secondary">
                    Пока нет данных.
                  </p>
                )}
                {topCostCenters.map((entry) => {
                  const width = maxCostCenterTotal
                    ? Math.round((entry.total / maxCostCenterTotal) * 100)
                    : 0;
                  return (
                    <div key={entry.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm text-text-main">
                        <span className="truncate">{entry.label}</span>
                        <span className="text-xs text-text-secondary">
                          {entry.total.toFixed(2)} кредитов
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-200">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {user.role === "ADMIN" && (
          <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
            <h2 className="text-lg font-semibold text-text-main mb-2 font-display">
              Cost centers
            </h2>
            <p className="text-xs text-text-secondary mb-4">
              Группируйте расходы по отделам или проектам.
            </p>
            <form action={createCostCenter} className="flex flex-wrap items-end gap-3">
              <input
                name="name"
                className="w-56 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                placeholder="Маркетинг"
              />
              <input
                name="code"
                className="w-40 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                placeholder="MKT"
              />
              <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                Создать
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {costCenters.length === 0 && (
                <p className="text-xs text-text-secondary">
                  Пока нет cost centers. Создайте первый.
                </p>
              )}
              {costCenters.map((center) => (
                <div
                  key={center.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-text-main">{center.name}</p>
                    <p className="text-xs text-text-secondary">
                      Код: {center.code ?? "—"} • Участников:{" "}
                      {costCenterCounts.get(center.id) ?? 0}
                    </p>
                  </div>
                  <form action={deleteCostCenter.bind(null, center.id)}>
                    <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white">
                      Удалить
                    </button>
                  </form>
                </div>
              ))}
              {costCenterCounts.get("unassigned") ? (
                <p className="text-xs text-text-secondary">
                  Без центра: {costCenterCounts.get("unassigned")} сотрудн.
                </p>
              ) : null}
            </div>
          </div>
        )}

        <QuotaDlpAuditManager
          actorPermissionKeys={actorPermissionKeys}
          orgBudget={Number(org?.budget ?? 0)}
          orgSpent={Number(org?.spent ?? 0)}
          members={members.map((member) => ({
            id: member.id,
            email: member.email,
            dailyLimit: member.dailyLimit === null ? null : Number(member.dailyLimit),
            monthlyLimit: member.monthlyLimit === null ? null : Number(member.monthlyLimit),
            dailySpent: Number(member.dailySpent ?? 0),
            monthlySpent: Number(member.monthlySpent ?? 0),
          }))}
          costCenters={costCenters.map((center) => ({ id: center.id, name: center.name }))}
          initialDlpPolicy={dlpPolicy}
          initialModelPolicy={modelPolicy}
        />

        {user.role === "ADMIN" && (
          <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
            <h2 className="text-lg font-semibold text-text-main mb-2 font-display">
              SSO и SCIM
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-text-main">SSO домены</h3>
                <form action={addSsoDomain} className="flex flex-wrap items-end gap-3">
                  <input
                    name="domain"
                    className="w-52 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                    placeholder="company.com"
                  />
                  <select
                    name="ssoOnly"
                    className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                    defaultValue="true"
                  >
                    <option value="true">Только SSO</option>
                    <option value="false">SSO опционально</option>
                  </select>
                  <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                    Добавить
                  </button>
                </form>
                <div className="space-y-2">
                  {domains.length === 0 && (
                    <p className="text-xs text-text-secondary">
                      Домены еще не добавлены.
                    </p>
                  )}
                  {domains.map((domain) => (
                    <div
                      key={domain.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-text-main">{domain.domain}</p>
                        <p className="text-xs text-text-secondary">
                          {domain.ssoOnly ? "Только SSO" : "SSO опционально"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <form action={updateSsoDomain.bind(null, domain.id)}>
                          <input
                            type="hidden"
                            name="ssoOnly"
                            value={domain.ssoOnly ? "false" : "true"}
                          />
                          <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white">
                            {domain.ssoOnly ? "Сделать опциональным" : "Только SSO"}
                          </button>
                        </form>
                        <form action={removeSsoDomain.bind(null, domain.id)}>
                          <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white">
                            Удалить
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-text-main">SCIM токены</h3>
                <p className="text-xs text-text-secondary">
                  SCIM endpoint: {appUrl}/api/scim
                </p>
                <ScimTokenManager />
              </div>
            </div>
          </div>
        )}

        <RbacManager
          roles={orgRoles.map((role) => ({
            id: role.id,
            name: role.name,
            isSystem: role.isSystem,
            permissionKeys: role.permissions.map((item) => item.permission.key),
          }))}
          actorPermissionKeys={actorPermissionKeys}
          costCenters={costCenters.map((center) => ({
            id: center.id,
            name: center.name,
          }))}
          policyContext={{
            dlpEnabled: dlpPolicy.enabled,
            dlpAction: dlpPolicy.action,
            modelPolicyMode: modelPolicy.mode,
            modelModelsCount: modelPolicy.models.length,
          }}
        />

        {canManageInvites && (
          <InviteManager
            roleOptions={inviteRoles}
            costCenterOptions={costCenters.map((center) => ({
              id: center.id,
              name: center.name,
            }))}
          />
        )}

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
            Сотрудники
          </h2>
          <div className="space-y-3">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-text-main">
                    {member.email ?? member.telegramId ?? member.id}
                  </p>
                  <p className="text-xs text-text-secondary">
                    Роль: {member.role} • Баланс: {member.balance.toString()} кредитов •{" "}
                    {member.isActive ? "Активен" : "Отключен"}
                  </p>
                </div>
                {user.role === "ADMIN" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <form
                      action={assignCostCenter.bind(null, member.id)}
                      className="flex items-end gap-2"
                    >
                      <select
                        name="costCenterId"
                        className="rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs"
                        defaultValue={member.costCenterId ?? ""}
                      >
                        <option value="">Без центра</option>
                        {costCenters.map((center) => (
                          <option key={center.id} value={center.id}>
                            {center.name}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-white">
                        Центр
                      </button>
                    </form>
                    <form
                      action={updateLimits.bind(null, member.id)}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input
                        name="dailyLimit"
                        type="number"
                        step="0.01"
                        className="w-28 rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs"
                        placeholder="Дневной"
                      />
                      <input
                        name="monthlyLimit"
                        type="number"
                        step="0.01"
                        className="w-28 rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs"
                        placeholder="Месячный"
                      />
                      <button className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover">
                        Лимиты
                      </button>
                    </form>
                    <form
                      action={transferCredits.bind(null, member.id)}
                      className="flex items-end gap-2"
                    >
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        className="w-24 rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-xs"
                        placeholder="Сумма"
                      />
                      <button className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800">
                        Перевести
                      </button>
                    </form>
                    <form action={toggleUserActive.bind(null, member.id)}>
                      <input
                        type="hidden"
                        name="isActive"
                        value={member.isActive ? "false" : "true"}
                      />
                      <button className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-white">
                        {member.isActive ? "Отключить" : "Включить"}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
