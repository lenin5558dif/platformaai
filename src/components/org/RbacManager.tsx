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
  const [activeSessionUserId, setActiveSessionUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<RbacUiMessage | null>(null);

  const canChangeRoles = actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_ROLE_CHANGE);
  const canManageUsers = actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_USER_MANAGE);
  const canReadRbac =
    canChangeRoles ||
    canManageUsers ||
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

  async function revokeMemberSessions(memberId: string) {
    if (!canManageUsers) {
      setMessage(mapRbacError("FORBIDDEN"));
      emitRbacEvent("revoke-sessions", "forbidden");
      return;
    }

    setActiveSessionUserId(memberId);
    setMessage(null);
    emitRbacEvent("revoke-sessions", "submit");

    try {
      const response = await fetch(`/api/org/users/${memberId}/revoke-sessions`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { code?: string } | null;
      if (!response.ok) {
        setMessage(mapRbacError(body?.code));
        emitRbacEvent(
          "revoke-sessions",
          body?.code === "FORBIDDEN" ? "forbidden" : "failure"
        );
        return;
      }

      setMessage({
        tone: "success",
        title: "Сессии отозваны",
        message: "Все активные входы этого участника завершены.",
      });
      emitRbacEvent("revoke-sessions", "success");
    } catch {
      setMessage(mapRbacError());
      emitRbacEvent("revoke-sessions", "failure");
    } finally {
      setActiveSessionUserId(null);
    }
  }

  return (
    <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold text-text-main font-display">RBAC доступы</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Роли задают базовые права, а ограничения по лимитам и политикам уточняют, что можно
            сделать прямо сейчас. Из этого блока удобно начинать ротацию ролей и отзыв сессий.
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700">
          <p className="font-semibold">Порядок работы</p>
          <p className="mt-1">Проверьте роль, затем при необходимости отзовите сессии.</p>
        </div>
      </div>

      <MessageBanner message={message} />

      <div className="grid gap-3 md:grid-cols-2">
        {roles.length === 0 ? (
          <div className="md:col-span-2 rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-4 text-sm text-text-secondary">
            Роли пока не настроены. Создайте хотя бы базовые Owner и Member, чтобы инвайты и
            управление участниками стали понятнее.
          </div>
        ) : (
          roles.map((role) => (
            <div key={role.id} className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-text-main">
                  {role.name} {role.isSystem ? "(System)" : ""}
                </p>
                <span className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-text-secondary">
                  {role.permissionKeys.length} permissions
                </span>
              </div>
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
                      {group.label}: {allowed ? "yes" : "no"}
                    </span>
                  );
                })}
              </div>
            </div>
          ))
        )}
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
            <div className="rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-4">
              <p className="text-sm font-medium text-text-main">Участников пока нет</p>
              <p className="mt-1 text-xs text-text-secondary">
                Отправьте invite или подключите SCIM, чтобы список наполнился автоматически.
              </p>
            </div>
          )}
          {!isLoading &&
            members.map((member) => (
              <div
                key={member.id}
                className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-main">
                      {member.email ?? member.id}
                    </p>
                    <p className="text-xs text-text-secondary">
                      Роль: {member.role?.name ?? member.legacyRole} • Баланс: {member.balance} •{" "}
                      {member.isActive ? "Активен" : "Отключен"}
                    </p>
                    <p className="mt-1 text-[11px] text-text-secondary">
                      ABAC: центр{" "}
                      {member.defaultCostCenterId
                        ? centerNameById.get(member.defaultCostCenterId) ?? "назначен"
                        : "не назначен"}
                      , лимиты D/M {member.dailyLimit ?? "-"}/{member.monthlyLimit ?? "-"}, DLP{" "}
                      {policyContext.dlpEnabled ? `on (${policyContext.dlpAction})` : "off"}, model
                      policy {policyContext.modelPolicyMode} ({policyContext.modelModelsCount})
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
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
                    {canManageUsers && (
                      <button
                        type="button"
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white disabled:opacity-60"
                        disabled={activeSessionUserId === member.id}
                        onClick={() => void revokeMemberSessions(member.id)}
                      >
                        {activeSessionUserId === member.id ? "Отзываем..." : "Отозвать сессии"}
                      </button>
                    )}
                    {!canChangeRoles && (
                      <span className="text-[11px] text-amber-700">Только просмотр</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
