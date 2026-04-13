"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import {
  RBAC_PERMISSION_GROUPS,
  mapRbacError,
  roleHasGroupPermission,
  type RbacMemberView,
  type RbacRoleView,
  type RbacUiMessage,
} from "@/lib/rbac-ui";

type CostCenterOption = {
  id: string;
  name: string;
};

type PolicyContext = {
  dlpEnabled: boolean;
  dlpAction: string;
  modelPolicyMode: string;
  modelModelsCount: number;
};

type RbacManagerProps = {
  roles: RbacRoleView[];
  actorPermissionKeys: string[];
  costCenters: CostCenterOption[];
  policyContext: PolicyContext;
};

function emitRbacEvent(action: string, outcome: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("platforma:rbac", {
      detail: {
        feature: "org-rbac-management-ui",
        action,
        outcome,
      },
    })
  );
}

function MessageBanner({ message }: { message: RbacUiMessage | null }) {
  if (!message) return null;
  const toneClass =
    message.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : message.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : message.tone === "info"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-red-200 bg-red-50 text-red-700";

  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${toneClass}`} aria-live="polite">
      <p className="font-semibold">{message.title}</p>
      <p className="mt-1">{message.message}</p>
    </div>
  );
}

export default function RbacManager({
  roles,
  actorPermissionKeys,
  costCenters,
  policyContext,
}: RbacManagerProps) {
  const [members, setMembers] = useState<RbacMemberView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<RbacUiMessage | null>(null);

  const canChangeRoles = actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_ROLE_CHANGE);
  const canReadRbac =
    canChangeRoles ||
    actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_USER_MANAGE) ||
    actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_AUDIT_READ) ||
    actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_ANALYTICS_READ);

  const centerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const center of costCenters) {
      map.set(center.id, center.name);
    }
    return map;
  }, [costCenters]);

  const loadMembers = useCallback(async () => {
    if (!canReadRbac) {
      setIsLoading(false);
      setMembers([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/org/users", { cache: "no-store" });
      const body = (await response.json()) as {
        data?: RbacMemberView[];
        code?: string;
      };
      if (!response.ok) {
        setMembers([]);
        setMessage(mapRbacError(body.code));
        emitRbacEvent("list-members", "failure");
        return;
      }
      setMembers(body.data ?? []);
      emitRbacEvent("list-members", "success");
    } catch {
      setMembers([]);
      setMessage(mapRbacError());
      emitRbacEvent("list-members", "failure");
    } finally {
      setIsLoading(false);
    }
  }, [canReadRbac]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function updateMemberRole(memberId: string, roleId: string) {
    if (!canChangeRoles) {
      setMessage(mapRbacError("FORBIDDEN"));
      emitRbacEvent("change-role", "forbidden");
      return;
    }

    setActiveUserId(memberId);
    setMessage(null);
    emitRbacEvent("change-role", "submit");
    try {
      const response = await fetch(`/api/org/users/${memberId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      const body = (await response.json()) as { code?: string };
      if (!response.ok) {
        setMessage(mapRbacError(body.code));
        emitRbacEvent("change-role", body.code === "FORBIDDEN" ? "forbidden" : "failure");
        return;
      }

      setMessage({
        tone: "success",
        title: "Роль обновлена",
        message: "Изменение применено после серверной проверки прав.",
      });
      await loadMembers();
      emitRbacEvent("change-role", "success");
    } catch {
      setMessage(mapRbacError());
      emitRbacEvent("change-role", "failure");
    } finally {
      setActiveUserId(null);
    }
  }

  return (
    <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
      <h2 className="text-lg font-semibold text-text-main font-display">RBAC доступы</h2>
      <p className="text-xs text-text-secondary">
        Роли определяют базовые права. Контекстные ограничения (ABAC) показываются отдельно и
        могут ограничивать действие даже при расширенной роли.
      </p>

      <MessageBanner message={message} />

      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((role) => (
          <div key={role.id} className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3">
            <p className="text-sm font-semibold text-text-main">
              {role.name} {role.isSystem ? "(Системная)" : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {RBAC_PERMISSION_GROUPS.map((group) => {
                const allowed = roleHasGroupPermission(role, group);
                return (
                  <span
                    key={group.id}
                    className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                      allowed
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {group.label}: {allowed ? "да" : "нет"}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!canReadRbac && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Недостаточно прав для просмотра RBAC-данных.
        </p>
      )}

      {canReadRbac && (
        <div className="space-y-2" aria-live="polite">
          {isLoading && <p className="text-xs text-text-secondary">Загружаем участников...</p>}
          {!isLoading && members.length === 0 && (
            <p className="text-xs text-text-secondary">Участники не найдены.</p>
          )}
          {!isLoading &&
            members.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-text-main">{member.email ?? member.id}</p>
                  <p className="text-xs text-text-secondary">
                    Роль: {member.role?.name ?? member.legacyRole} • Баланс: {member.balance} •{" "}
                    {member.isActive ? "Активен" : "Отключен"}
                  </p>
                  <p className="text-[11px] text-text-secondary mt-1">
                    ABAC: центр {" "}
                    {member.defaultCostCenterId
                      ? centerNameById.get(member.defaultCostCenterId) ?? "назначен"
                      : "не назначен"}
                    , лимиты D/M {member.dailyLimit ?? "-"}/{member.monthlyLimit ?? "-"}, DLP {" "}
                    {policyContext.dlpEnabled ? `вкл. (${policyContext.dlpAction})` : "выкл."}, политика моделей{" "}
                    {policyContext.modelPolicyMode} ({policyContext.modelModelsCount})
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-text-secondary" htmlFor={`role-${member.id}`}>
                    Назначить роль
                  </label>
                  <select
                    id={`role-${member.id}`}
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                    value={member.role?.id ?? ""}
                    disabled={!canChangeRoles || activeUserId === member.id}
                    onChange={(event) => void updateMemberRole(member.id, event.target.value)}
                  >
                    {!member.role && <option value="">Роль не назначена</option>}
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  {!canChangeRoles && (
                    <span className="text-[11px] text-amber-700">Только просмотр</span>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
