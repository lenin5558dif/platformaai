import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { formatCreditsLabel } from "@/lib/billing-display";
import {
  getBillingTier,
  getBillingTierLabel,
  getBillingTierOptions,
  type BillingTier,
} from "@/lib/billing-tiers";
import { requireAdminActor } from "@/lib/admin-auth";
import { deleteUserByAdmin } from "@/lib/admin-user-delete";
import { issueAdminPasswordResetToken } from "@/lib/admin-password-reset";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http-error";
import { revokeAllSessionsForUser } from "@/lib/session-revoke";
import { sendPasswordResetEmail } from "@/lib/unisender";
import { mergeSettings } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

type ActivityRow = {
  userId: string;
  requests7d: number;
  tokens7d: number;
  lastActivityAt: Date | null;
};

function formatDate(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function parseOptionalNumber(value: FormDataEntryValue | null) {
  if (!value || typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

const smallButtonClass =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-text-main transition-colors motion-safe:duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

const primarySmallButtonClass =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors motion-safe:duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

const inputClass =
  "min-h-9 rounded-lg border border-gray-200 bg-white/70 px-2.5 py-2 text-xs transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

async function setUserLimits(userId: string, formData: FormData) {
  "use server";
  const admin = await requireAdminActor();

  const dailyLimit = parseOptionalNumber(formData.get("dailyLimit"));
  const monthlyLimit = parseOptionalNumber(formData.get("monthlyLimit"));

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, orgId: true },
  });
  if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      dailyLimit: dailyLimit ?? undefined,
      monthlyLimit: monthlyLimit ?? undefined,
    },
    select: { id: true },
  });

  await logAudit({
    action: "USER_UPDATED",
    orgId: user.orgId ?? null,
    actorId: admin.id,
    targetType: "user",
    targetId: user.id,
    metadata: {
      adminSection: "clients",
      dailyLimit: dailyLimit ?? null,
      monthlyLimit: monthlyLimit ?? null,
    },
  });

  revalidatePath("/admin/clients");
}

async function setUserPlan(userId: string, formData: FormData) {
  "use server";
  const admin = await requireAdminActor();
  const billingTierValue = String(formData.get("billingTier") ?? "").trim();
  const billingTier = getBillingTierOptions().find((item) => item.id === billingTierValue)
    ?.id as BillingTier | undefined;
  if (!billingTier) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, settings: true, orgId: true },
  });
  if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      settings: mergeSettings(user.settings ?? {}, {
        billingTier,
        planName: getBillingTierLabel(billingTier),
      }),
    },
    select: { id: true },
  });

  await logAudit({
    action: "USER_UPDATED",
    orgId: user.orgId ?? null,
    actorId: admin.id,
    targetType: "user",
    targetId: user.id,
    metadata: {
      adminSection: "clients",
      billingTier,
      planForced: true,
    },
  });

  revalidatePath("/admin/clients");
}

async function setUserActive(userId: string, formData: FormData) {
  "use server";
  const admin = await requireAdminActor();
  const isActive = String(formData.get("isActive")) === "true";

  const user = await prisma.user.update({
    where: { id: userId },
    data: { isActive },
    select: { id: true, orgId: true },
  });

  await logAudit({
    action: isActive ? "USER_UPDATED" : "USER_DISABLED",
    orgId: user.orgId ?? null,
    actorId: admin.id,
    targetType: "user",
    targetId: user.id,
    metadata: {
      adminSection: "clients",
      isActive,
    },
  });

  revalidatePath("/admin/clients");
}

async function revokeUserSessions(userId: string) {
  "use server";
  const admin = await requireAdminActor();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, orgId: true },
  });
  if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");

  const { revokedAt, deletedSessions } = await revokeAllSessionsForUser(user.id);
  await logAudit({
    action: "USER_UPDATED",
    orgId: user.orgId ?? null,
    actorId: admin.id,
    targetType: "user",
    targetId: user.id,
    metadata: {
      adminSection: "clients",
      sessionGlobalRevoke: {
        revokedAt: revokedAt.toISOString(),
        deletedSessions,
      },
    },
  });

  revalidatePath("/admin/clients");
}

async function requestPasswordReset(userId: string) {
  "use server";
  const admin = await requireAdminActor();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, orgId: true },
  });
  if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");
  if (!user.email) {
    throw new HttpError(400, "EMAIL_REQUIRED", "User has no email");
  }

  const token = await issueAdminPasswordResetToken({
    userId: user.id,
    requestedById: admin.id,
  });

  await sendPasswordResetEmail({
    email: user.email,
    resetUrl: token.resetUrl,
  });

  await logAudit({
    action: "ADMIN_PASSWORD_RESET_REQUESTED",
    orgId: user.orgId ?? null,
    actorId: admin.id,
    targetType: "user",
    targetId: user.id,
    metadata: {
      adminSection: "clients",
      tokenPrefix: token.tokenPrefix,
      expiresAt: token.expiresAt.toISOString(),
      delivery: "email",
    },
  });

  revalidatePath("/admin/clients");
}

async function deleteUser(userId: string) {
  "use server";
  const admin = await requireAdminActor();
  await deleteUserByAdmin({
    prisma,
    actorId: admin.id,
    userId,
  });
  revalidatePath("/admin/clients");
}

export default async function AdminClientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ userId?: string }>;
}) {
  await requireAdminActor();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [users, orgs, activityRows] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        orgId: true,
        balance: true,
        settings: true,
        dailyLimit: true,
        monthlyLimit: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.organization.findMany({
      select: { id: true, name: true },
    }),
    prisma.$queryRaw<ActivityRow[]>`
      SELECT
        "userId" AS "userId",
        COUNT(*)::int AS "requests7d",
        COALESCE(SUM("tokenCount"), 0)::int AS "tokens7d",
        MAX("createdAt") AS "lastActivityAt"
      FROM "Message"
      WHERE "role" = 'ASSISTANT'
        AND "createdAt" >= ${weekAgo}
      GROUP BY "userId"
    `,
  ]);

  const orgById = new Map(orgs.map((org) => [org.id, org.name]));
  const activityByUserId = new Map(
    activityRows.map((row) => [row.userId, row])
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Клиенты
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Пользователи, их статус, тариф и базовые admin-операции.
        </p>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-4 md:p-6 overflow-x-auto">
        <table className="w-full text-sm table-fixed min-w-[840px]">
          <thead>
            <tr className="text-left text-xs text-text-secondary">
              <th className="pb-3 pr-3 w-[34%]">Клиент</th>
              <th className="pb-3 pr-3 w-[16%]">Регистрация</th>
              <th className="pb-3 pr-3 w-[24%]">Активность</th>
              <th className="pb-3 w-[26%]">Управление</th>
            </tr>
          </thead>
          <tbody className="text-text-main">
            {users.map((user) => {
              const settingsValue = user.settings as Prisma.JsonValue;
              const billingTier = getBillingTier(settingsValue, user.balance);
              const planName = getBillingTierLabel(billingTier);
              const activity = activityByUserId.get(user.id);
              return (
                <tr key={user.id} className="border-t border-white/40 align-top">
                  <td className="py-3 pr-3">
                    <p className="font-medium break-all">{user.email ?? user.id}</p>
                    <p className="text-xs text-text-secondary mt-1">
                      Роль: {user.role} • Орг: {user.orgId ? orgById.get(user.orgId) ?? user.orgId : "—"}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      Статус:{" "}
                      <span className={user.isActive ? "text-emerald-700" : "text-rose-700"}>
                        {user.isActive ? "Активен" : "Заблокирован"}
                      </span>
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      Баланс: {formatCreditsLabel(user.balance.toString())}
                    </p>
                  </td>
                  <td className="py-3 pr-3 text-xs">
                    <p>{formatDate(user.createdAt)}</p>
                  </td>
                  <td className="py-3 pr-3 text-xs">
                    <p>Запросов 7д: {activity?.requests7d ?? 0}</p>
                    <p className="mt-1">Токенов 7д: {activity?.tokens7d ?? 0}</p>
                    <p className="mt-1">
                      Последняя активность: {formatDate(activity?.lastActivityAt ?? null)}
                    </p>
                  </td>
                  <td className="py-3">
                    <details className="rounded-lg border border-gray-200 bg-white/70">
                      <summary className="list-none flex min-h-10 cursor-pointer items-center justify-between gap-3 px-3 py-2.5 transition-colors motion-safe:duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{planName}</p>
                          <p className="text-[11px] text-text-secondary truncate">
                            Тариф: {billingTier}
                          </p>
                          <p className="text-[11px] text-text-secondary truncate">
                            Лимиты: D {user.dailyLimit?.toString() ?? "—"} / M {user.monthlyLimit?.toString() ?? "—"} кредитов
                          </p>
                        </div>
                        <span className="material-symbols-outlined text-[18px] text-text-secondary">
                          expand_more
                        </span>
                      </summary>
                      <div className="space-y-3 border-t border-gray-200 p-3">
                        <form action={setUserPlan.bind(null, user.id)} className="flex gap-2">
                          <select
                            name="billingTier"
                            defaultValue={billingTier}
                            className={`${inputClass} min-w-0 flex-1`}
                          >
                            {getBillingTierOptions().map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button className={smallButtonClass}>
                            Тариф
                          </button>
                        </form>
                        <form
                          action={setUserLimits.bind(null, user.id)}
                          className="grid grid-cols-2 gap-2"
                        >
                          <input
                            name="dailyLimit"
                            type="number"
                            step="0.01"
                            defaultValue={user.dailyLimit?.toString() ?? ""}
                            placeholder="Дневной"
                            className={inputClass}
                          />
                          <input
                            name="monthlyLimit"
                            type="number"
                            step="0.01"
                            defaultValue={user.monthlyLimit?.toString() ?? ""}
                            placeholder="Месячный"
                            className={inputClass}
                          />
                          <button className={`${primarySmallButtonClass} col-span-2`}>
                            Сохранить лимиты
                          </button>
                        </form>
                        <div className="grid gap-2">
                          <form action={setUserActive.bind(null, user.id)}>
                            <input type="hidden" name="isActive" value={user.isActive ? "false" : "true"} />
                            <button className={`${smallButtonClass} w-full`}>
                              {user.isActive ? "Блокировать" : "Разблокировать"}
                            </button>
                          </form>
                          <form action={revokeUserSessions.bind(null, user.id)}>
                            <button className={`${smallButtonClass} w-full`}>
                              Сбросить сессии
                            </button>
                          </form>
                          {user.email ? (
                            <form action={requestPasswordReset.bind(null, user.id)}>
                              <button className={`${smallButtonClass} w-full`}>
                                Сброс пароля
                              </button>
                            </form>
                          ) : (
                            <p className="text-[11px] text-text-secondary">Нет email для reset</p>
                          )}
                          <form action={deleteUser.bind(null, user.id)}>
                            <button className="inline-flex min-h-9 w-full cursor-pointer items-center justify-center rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors motion-safe:duration-150 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200">
                              Удалить пользователя
                            </button>
                          </form>
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
