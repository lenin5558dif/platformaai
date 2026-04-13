import { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  ORG_UPDATED: "Организация",
  USER_INVITED: "Приглашение",
  USER_UPDATED: "Пользователь",
  USER_DISABLED: "Отключение",
  COST_CENTER_CREATED: "Cost center",
  COST_CENTER_UPDATED: "Cost center",
  COST_CENTER_DELETED: "Cost center",
  COST_CENTER_ASSIGNED: "Назначение CC",
  DLP_POLICY_UPDATED: "DLP",
  MODEL_POLICY_UPDATED: "Политика моделей",
  POLICY_BLOCKED: "Блокировка политики",
  SCIM_TOKEN_CREATED: "SCIM токен",
  SCIM_TOKEN_REVOKED: "SCIM токен",
  SCIM_USER_SYNC: "SCIM user",
  SCIM_GROUP_SYNC: "SCIM group",
  SSO_DOMAIN_UPDATED: "SSO домен",
  BILLING_REFILL: "Billing refill",
  ADMIN_PASSWORD_RESET_REQUESTED: "Сброс пароля",
  ADMIN_PASSWORD_RESET_COMPLETED: "Сброс пароля",
  PLATFORM_SYSTEM_PROMPT_UPDATED: "System prompt",
  PLATFORM_MODEL_TOGGLED: "Модель",
  ORG_PROVIDER_CREDENTIAL_UPDATED: "Provider credential",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string; actor?: string }>;
}) {
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
      ...(actionFilter ? { action: actionFilter } : {}),
      ...(actorFilter ? { actorId: actorFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Аудит платформы
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Глобальная история административных действий и политик безопасности.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-4">
        <div>
          <label className="block text-xs text-text-secondary">Action</label>
          <select
            name="action"
            defaultValue={actionFilter ?? ""}
            className="mt-2 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
          >
            <option value="">Все</option>
            {Object.values(AuditAction).map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-secondary">Actor ID</label>
          <input
            name="actor"
            defaultValue={actorFilter ?? ""}
            className="mt-2 w-56 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
            placeholder="cuid..."
          />
        </div>
        <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
          Применить
        </button>
      </form>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
          Последние audit-события
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
                  <th className="pb-3">Орг</th>
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
                      {log.orgId ?? "—"}
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
  );
}
