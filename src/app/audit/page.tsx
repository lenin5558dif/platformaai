import { AuditAction } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  ORG_UPDATED: "Организация",
  USER_INVITED: "Приглашение",
  USER_UPDATED: "Пользователь",
  USER_DISABLED: "Отключение",
  COST_CENTER_CREATED: "Центр затрат",
  COST_CENTER_UPDATED: "Центр затрат",
  COST_CENTER_DELETED: "Центр затрат",
  COST_CENTER_ASSIGNED: "Назначение CC",
  DLP_POLICY_UPDATED: "DLP",
  MODEL_POLICY_UPDATED: "Политика моделей",
  POLICY_BLOCKED: "Блокировка политики",
  SCIM_TOKEN_CREATED: "SCIM токен",
  SCIM_TOKEN_REVOKED: "SCIM токен",
  SCIM_USER_SYNC: "SCIM пользователь",
  SCIM_GROUP_SYNC: "SCIM группа",
  SSO_DOMAIN_UPDATED: "SSO домен",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string; actor?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Доступ запрещен
          </h1>
          <p className="text-sm text-text-secondary">Требуется авторизация.</p>
        </div>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, role: true },
  });

  if (user?.role !== "ADMIN") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Недостаточно прав
          </h1>
          <p className="text-sm text-text-secondary">
            Страница аудит‑логов доступна администраторам.
          </p>
        </div>
      </div>
    );
  }

  if (!user.orgId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Организация не создана
          </h1>
          <p className="text-sm text-text-secondary">
            Создайте организацию, чтобы начать собирать аудит‑логи.
          </p>
          <a
            className="mt-4 inline-flex items-center justify-center rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
            href="/org"
          >
            Перейти в организацию
          </a>
        </div>
      </div>
    );
  }

  const params = searchParams ? await searchParams : undefined;
  const actionFilterValue = params?.action?.trim();
  const actionFilter =
    actionFilterValue &&
    Object.values(AuditAction).includes(actionFilterValue as AuditAction)
      ? (actionFilterValue as AuditAction)
      : null;
  const actorFilter = params?.actor?.trim() || null;

  const logs = await prisma.auditLog.findMany({
    where: {
      orgId: user.orgId,
      ...(actionFilter ? { action: actionFilter } : {}),
      ...(actorFilter ? { actorId: actorFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Аудит-логи
          </h1>
          <p className="text-sm text-text-secondary">
            История административных действий и политик безопасности.
          </p>
        </div>

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
            Последние события
          </h2>
          {logs.length === 0 ? (
            <p className="text-sm text-text-secondary">Логи пока пустые.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-secondary">
                    <th className="pb-3">Дата</th>
                    <th className="pb-3">Действие</th>
                    <th className="pb-3">Актор</th>
                    <th className="pb-3">Цель</th>
                    <th className="pb-3">Детали</th>
                  </tr>
                </thead>
                <tbody className="text-text-main">
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-white/40">
                      <td className="py-3 pr-4 text-xs text-text-secondary">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="py-3 pr-4">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </td>
                      <td className="py-3 pr-4 text-xs text-text-secondary">
                        {log.actorId ?? "—"}
                      </td>
                      <td className="py-3 pr-4 text-xs text-text-secondary">
                        {log.targetType ?? "—"} {log.targetId ?? ""}
                      </td>
                      <td className="py-3 text-xs text-text-secondary">
                        {log.metadata ? JSON.stringify(log.metadata) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
