"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import {
  emitGovernanceEvent,
  mapGovernanceError,
  normalizeQuotaStatus,
  statusBadgeClass,
  statusLabel,
  type GovernanceUiMessage,
} from "@/lib/governance-ui";

type MemberQuota = {
  id: string;
  email: string | null;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  dailySpent: number;
  monthlySpent: number;
};

type CostCenterOption = {
  id: string;
  name: string;
};

type DlpPolicy = {
  enabled: boolean;
  action: "block" | "redact";
  patterns: string[];
};

type ModelPolicy = {
  mode: "allowlist" | "denylist";
  models: string[];
};

type AuditEvent = {
  id: string;
  createdAt: string;
  action: string;
  channel: string | null;
  actorId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  correlationId: string | null;
  metadata: unknown;
};

type Props = {
  actorPermissionKeys: string[];
  orgBudget: number;
  orgSpent: number;
  members: MemberQuota[];
  costCenters: CostCenterOption[];
  initialDlpPolicy: DlpPolicy;
  initialModelPolicy: ModelPolicy;
};

function MessageBanner({ message }: { message: GovernanceUiMessage | null }) {
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

export default function QuotaDlpAuditManager({
  actorPermissionKeys,
  orgBudget,
  orgSpent,
  members,
  costCenters,
  initialDlpPolicy,
  initialModelPolicy,
}: Props) {
  const [message, setMessage] = useState<GovernanceUiMessage | null>(null);
  const [membersState, setMembersState] = useState<MemberQuota[]>(members);
  const [centerBudgets, setCenterBudgets] = useState<Record<string, { budget: number; spent: number }>>(
    {}
  );
  const [activeLimitUserId, setActiveLimitUserId] = useState<string | null>(null);

  const [dlpPolicy, setDlpPolicy] = useState<DlpPolicy>(initialDlpPolicy);
  const [modelPolicy, setModelPolicy] = useState<ModelPolicy>(initialModelPolicy);
  const [policyBusy, setPolicyBusy] = useState<"dlp" | "model" | null>(null);

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [auditFilters, setAuditFilters] = useState<{
    actor: string;
    action: string;
    channel: "" | "WEB" | "TELEGRAM";
    period: "" | "24h" | "7d" | "30d";
  }>({
    actor: "",
    action: "",
    channel: "",
    period: "7d",
  });

  const canManageLimits = actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_LIMITS_MANAGE);
  const canManagePolicy = actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_POLICY_UPDATE);
  const canReadAudit = actorPermissionKeys.includes(ORG_PERMISSIONS.ORG_AUDIT_READ);

  const orgStatus = normalizeQuotaStatus(orgBudget, orgSpent);

  const selectedAudit = useMemo(
    () => auditEvents.find((event) => event.id === selectedAuditId) ?? null,
    [auditEvents, selectedAuditId]
  );

  const loadCostCenterBudgets = useCallback(async () => {
    if (!canManageLimits || costCenters.length === 0) return;

    try {
      const entries = await Promise.all(
        costCenters.map(async (center) => {
          const response = await fetch(`/api/org/cost-centers/${center.id}/budget`, {
            cache: "no-store",
          });
          if (!response.ok) {
            return [center.id, { budget: 0, spent: 0 }] as const;
          }
          const body = (await response.json()) as { data?: { budget: number; spent: number } };
          return [center.id, body.data ?? { budget: 0, spent: 0 }] as const;
        })
      );

      setCenterBudgets(Object.fromEntries(entries));
    } catch {
      // Non-blocking for main UI
    }
  }, [canManageLimits, costCenters]);

  const loadAudit = useCallback(async () => {
    if (!canReadAudit) {
      setAuditEvents([]);
      return;
    }

    setAuditBusy(true);
    emitGovernanceEvent("org-audit-observability-ui", "filter", "submit");
    try {
      const params = new URLSearchParams();
      if (auditFilters.actor) params.set("actor", auditFilters.actor);
      if (auditFilters.action) params.set("action", auditFilters.action);
      if (auditFilters.channel) params.set("channel", auditFilters.channel);
      if (auditFilters.period) params.set("period", auditFilters.period);

      const response = await fetch(`/api/org/audit?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as { code?: string; data?: AuditEvent[] };
      if (!response.ok) {
        setMessage(mapGovernanceError(body.code));
        setAuditEvents([]);
        emitGovernanceEvent("org-audit-observability-ui", "filter", "failure");
        return;
      }

      setAuditEvents(body.data ?? []);
      setSelectedAuditId((current) => (current ? current : body.data?.[0]?.id ?? null));
      emitGovernanceEvent("org-audit-observability-ui", "filter", "success");
    } catch {
      setMessage(mapGovernanceError());
      setAuditEvents([]);
      emitGovernanceEvent("org-audit-observability-ui", "filter", "failure");
    } finally {
      setAuditBusy(false);
    }
  }, [canReadAudit, auditFilters]);

  useEffect(() => {
    void loadCostCenterBudgets();
  }, [loadCostCenterBudgets]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  async function updateUserLimits(memberId: string, dailyLimit: string, monthlyLimit: string) {
    if (!canManageLimits) {
      setMessage(mapGovernanceError("FORBIDDEN"));
      return;
    }

    setActiveLimitUserId(memberId);
    setMessage(null);
    emitGovernanceEvent("org-quota-governance-ui", "update-limit", "submit");
    try {
      const dailyParsed = dailyLimit.trim() ? Number(dailyLimit) : null;
      const monthlyParsed = monthlyLimit.trim() ? Number(monthlyLimit) : null;

      if (
        (dailyParsed !== null && !Number.isFinite(dailyParsed)) ||
        (monthlyParsed !== null && !Number.isFinite(monthlyParsed))
      ) {
        setMessage(mapGovernanceError("INVALID_INPUT"));
        emitGovernanceEvent("org-quota-governance-ui", "update-limit", "failure");
        return;
      }

      const response = await fetch(`/api/org/users/${memberId}/limits`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dailyLimit: dailyParsed,
          monthlyLimit: monthlyParsed,
        }),
      });

      const body = (await response.json()) as {
        code?: string;
        data?: { dailyLimit: string | null; monthlyLimit: string | null };
      };
      if (!response.ok) {
        setMessage(mapGovernanceError(body.code));
        emitGovernanceEvent("org-quota-governance-ui", "update-limit", "failure");
        return;
      }

      setMembersState((current) =>
        current.map((entry) =>
          entry.id === memberId
            ? {
                ...entry,
                dailyLimit: body.data?.dailyLimit ? Number(body.data.dailyLimit) : null,
                monthlyLimit: body.data?.monthlyLimit ? Number(body.data.monthlyLimit) : null,
              }
            : entry
        )
      );

      setMessage({
        tone: "success",
        title: "Лимиты обновлены",
        message: "Изменения применены после серверной проверки.",
      });
      emitGovernanceEvent("org-quota-governance-ui", "update-limit", "success");
    } catch {
      setMessage(mapGovernanceError());
      emitGovernanceEvent("org-quota-governance-ui", "update-limit", "failure");
    } finally {
      setActiveLimitUserId(null);
    }
  }

  async function savePolicy(type: "dlp" | "model") {
    if (!canManagePolicy) {
      setMessage(mapGovernanceError("FORBIDDEN"));
      return;
    }

    setPolicyBusy(type);
    setMessage(null);
    emitGovernanceEvent("org-dlp-policy-ui", `save-${type}`, "submit");
    try {
      const payload =
        type === "dlp"
          ? {
              type,
              enabled: dlpPolicy.enabled,
              action: dlpPolicy.action,
              patterns: dlpPolicy.patterns,
            }
          : {
              type,
              mode: modelPolicy.mode,
              models: modelPolicy.models,
            };

      const response = await fetch("/api/org/policies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as { code?: string };
      if (!response.ok) {
        setMessage(mapGovernanceError(body.code));
        emitGovernanceEvent("org-dlp-policy-ui", `save-${type}`, "failure");
        return;
      }

      setMessage({
        tone: "success",
        title: type === "dlp" ? "DLP сохранен" : "Модельная политика сохранена",
        message: "Политика применена и подтверждена сервером.",
      });
      emitGovernanceEvent("org-dlp-policy-ui", `save-${type}`, "success");
    } catch {
      setMessage(mapGovernanceError());
      emitGovernanceEvent("org-dlp-policy-ui", `save-${type}`, "failure");
    } finally {
      setPolicyBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <MessageBanner message={message} />

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-text-main font-display">Quota governance</h2>
        <p className="text-xs text-text-secondary">
          Статусы нормализованы: ok / warning / blocked / unknown. Обновления лимитов применяются
          только после подтверждения сервера.
        </p>

        <div className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3">
          <p className="text-sm font-medium text-text-main">Организация</p>
          <p className="text-xs text-text-secondary mt-1">
            Бюджет: {orgBudget.toFixed(2)} • Потрачено: {orgSpent.toFixed(2)}
          </p>
          <span
            className={`inline-block mt-2 rounded-full px-2 py-1 text-[11px] font-medium ${statusBadgeClass(
              orgStatus
            )}`}
          >
            {statusLabel(orgStatus)}
          </span>
        </div>

        {!canManageLimits && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Лимиты доступны только для чтения: у вас нет прав на изменение.
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {membersState.map((member) => {
            const memberStatus = normalizeQuotaStatus(member.monthlyLimit, member.monthlySpent);
            return (
              <form
                key={member.id}
                className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const target = event.currentTarget;
                  const daily = new FormData(target).get("dailyLimit");
                  const monthly = new FormData(target).get("monthlyLimit");
                  void updateUserLimits(
                    member.id,
                    typeof daily === "string" ? daily : "",
                    typeof monthly === "string" ? monthly : ""
                  );
                }}
              >
                <p className="text-sm font-medium text-text-main">{member.email ?? member.id}</p>
                <p className="text-xs text-text-secondary">
                  Spent D/M: {member.dailySpent.toFixed(2)} / {member.monthlySpent.toFixed(2)}
                </p>
                <span
                  className={`inline-block rounded-full px-2 py-1 text-[11px] font-medium ${statusBadgeClass(
                    memberStatus
                  )}`}
                >
                  {statusLabel(memberStatus)}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="dailyLimit"
                    type="number"
                    step="0.01"
                    defaultValue={member.dailyLimit ?? ""}
                    placeholder="daily"
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                    aria-label="Daily limit"
                    disabled={!canManageLimits || activeLimitUserId === member.id}
                  />
                  <input
                    name="monthlyLimit"
                    type="number"
                    step="0.01"
                    defaultValue={member.monthlyLimit ?? ""}
                    placeholder="monthly"
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                    aria-label="Monthly limit"
                    disabled={!canManageLimits || activeLimitUserId === member.id}
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white disabled:opacity-60"
                  disabled={!canManageLimits || activeLimitUserId === member.id}
                >
                  {activeLimitUserId === member.id ? "Сохраняем..." : "Обновить лимиты"}
                </button>
              </form>
            );
          })}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3">
          <p className="text-sm font-medium text-text-main mb-2">Cost centers</p>
          <div className="space-y-1">
            {costCenters.map((center) => {
              const budget = centerBudgets[center.id]?.budget ?? 0;
              const spent = centerBudgets[center.id]?.spent ?? 0;
              const status = normalizeQuotaStatus(budget, spent);
              return (
                <p key={center.id} className="text-xs text-text-secondary flex items-center gap-2">
                  <span>{center.name}</span>
                  <span>
                    {spent.toFixed(2)} / {budget.toFixed(2)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${statusBadgeClass(status)}`}>
                    {statusLabel(status)}
                  </span>
                </p>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-text-main font-display">DLP и model policy</h2>
        {!canManagePolicy && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Доступ только для чтения: изменение политик запрещено.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-xl border border-gray-200 bg-white/70 px-4 py-3">
            <h3 className="text-sm font-semibold text-text-main">DLP</h3>
            <select
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={dlpPolicy.enabled ? "true" : "false"}
              onChange={(event) =>
                setDlpPolicy((current) => ({ ...current, enabled: event.target.value === "true" }))
              }
              disabled={!canManagePolicy || policyBusy !== null}
            >
              <option value="true">Включено</option>
              <option value="false">Выключено</option>
            </select>
            <select
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={dlpPolicy.action}
              onChange={(event) =>
                setDlpPolicy((current) => ({
                  ...current,
                  action: event.target.value as "block" | "redact",
                }))
              }
              disabled={!canManagePolicy || policyBusy !== null}
            >
              <option value="block">Блокировать</option>
              <option value="redact">Редактировать</option>
            </select>
            <textarea
              rows={5}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
              value={dlpPolicy.patterns.join("\n")}
              onChange={(event) =>
                setDlpPolicy((current) => ({
                  ...current,
                  patterns: event.target.value
                    .split(/\r?\n|,/) 
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                }))
              }
              disabled={!canManagePolicy || policyBusy !== null}
            />
            <p className="text-[11px] text-text-secondary">
              Эффект: при совпадении DLP правило может {dlpPolicy.action === "block" ? "блокировать" : "редактировать"} запрос до отправки во внешнюю модель.
            </p>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              disabled={!canManagePolicy || policyBusy !== null}
              onClick={() => void savePolicy("dlp")}
            >
              {policyBusy === "dlp" ? "Сохраняем..." : "Сохранить DLP"}
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-gray-200 bg-white/70 px-4 py-3">
            <h3 className="text-sm font-semibold text-text-main">Model policy</h3>
            <select
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              value={modelPolicy.mode}
              onChange={(event) =>
                setModelPolicy((current) => ({
                  ...current,
                  mode: event.target.value as "allowlist" | "denylist",
                }))
              }
              disabled={!canManagePolicy || policyBusy !== null}
            >
              <option value="allowlist">Allowlist</option>
              <option value="denylist">Denylist</option>
            </select>
            <textarea
              rows={5}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
              value={modelPolicy.models.join("\n")}
              onChange={(event) =>
                setModelPolicy((current) => ({
                  ...current,
                  models: event.target.value
                    .split(/\r?\n|,/) 
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                }))
              }
              disabled={!canManagePolicy || policyBusy !== null}
            />
            <p className="text-[11px] text-text-secondary">
              Режим {modelPolicy.mode}; записей: {modelPolicy.models.length}
            </p>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              disabled={!canManagePolicy || policyBusy !== null}
              onClick={() => void savePolicy("model")}
            >
              {policyBusy === "model" ? "Сохраняем..." : "Сохранить policy"}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-text-main font-display">Audit timeline</h2>
        {!canReadAudit && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Нет права `org:audit.read` для просмотра audit-событий.
          </p>
        )}

        {canReadAudit && (
          <>
            <div className="grid gap-2 md:grid-cols-4">
              <input
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
                placeholder="actor"
                value={auditFilters.actor}
                onChange={(event) =>
                  setAuditFilters((current) => ({ ...current, actor: event.target.value }))
                }
              />
              <input
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
                placeholder="action"
                value={auditFilters.action}
                onChange={(event) =>
                  setAuditFilters((current) => ({ ...current, action: event.target.value.toUpperCase() }))
                }
              />
              <select
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
                value={auditFilters.channel}
                onChange={(event) =>
                  setAuditFilters((current) => ({
                    ...current,
                    channel: event.target.value as "" | "WEB" | "TELEGRAM",
                  }))
                }
              >
                <option value="">all channels</option>
                <option value="WEB">WEB</option>
                <option value="TELEGRAM">TELEGRAM</option>
              </select>
              <select
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
                value={auditFilters.period}
                onChange={(event) =>
                  setAuditFilters((current) => ({
                    ...current,
                    period: event.target.value as "" | "24h" | "7d" | "30d",
                  }))
                }
              >
                <option value="">all time</option>
                <option value="24h">24h</option>
                <option value="7d">7d</option>
                <option value="30d">30d</option>
              </select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                {auditBusy && <p className="text-xs text-text-secondary">Загрузка audit...</p>}
                {!auditBusy && auditEvents.length === 0 && (
                  <p className="text-xs text-text-secondary">События не найдены.</p>
                )}
                {!auditBusy &&
                  auditEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`w-full text-left rounded-xl border px-3 py-2 ${
                        selectedAuditId === event.id
                          ? "border-primary/40 bg-primary/5"
                          : "border-gray-200 bg-white/70"
                      }`}
                      onClick={() => {
                        setSelectedAuditId(event.id);
                        emitGovernanceEvent("org-audit-observability-ui", "inspect", "success");
                      }}
                    >
                      <p className="text-xs font-semibold text-text-main">{event.action}</p>
                      <p className="text-[11px] text-text-secondary">
                        {new Date(event.createdAt).toLocaleString("ru-RU")} • {event.channel ?? "-"}
                      </p>
                      <p className="text-[11px] text-text-secondary">
                        {event.actorEmail ?? event.actorId ?? "unknown actor"}
                      </p>
                    </button>
                  ))}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3">
                {!selectedAudit && (
                  <p className="text-xs text-text-secondary">Выберите событие для деталей.</p>
                )}
                {selectedAudit && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-text-main">{selectedAudit.action}</p>
                    <p className="text-xs text-text-secondary">
                      actor: {selectedAudit.actorEmail ?? selectedAudit.actorId ?? "-"}
                    </p>
                    <p className="text-xs text-text-secondary">
                      target: {selectedAudit.targetType ?? "-"}/{selectedAudit.targetId ?? "-"}
                    </p>
                    <p className="text-xs text-text-secondary">
                      correlation: {selectedAudit.correlationId ?? "-"}
                    </p>
                    <pre className="overflow-auto rounded-lg bg-slate-950 text-slate-100 p-3 text-[11px]">
                      {JSON.stringify(selectedAudit.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
