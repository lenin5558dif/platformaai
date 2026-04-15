"use client";

import { useEffect, useMemo, useState } from "react";
import {
  mapInviteError,
  parseInviteActionResult,
  type InviteListItem,
  type InviteUiMessage,
} from "@/lib/invite-ui";

type RoleOption = {
  id: string;
  name: string;
};

type CostCenterOption = {
  id: string;
  name: string;
};

type InviteManagerProps = {
  roleOptions: RoleOption[];
  costCenterOptions: CostCenterOption[];
};

function emitInviteEvent(action: string, outcome: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("platforma:invite", {
      detail: {
        feature: "org-invite-management-ui",
        action,
        outcome,
      },
    })
  );
}

function MessageBanner({ message }: { message: InviteUiMessage | null }) {
  if (!message) {
    return null;
  }

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

export default function InviteManager({
  roleOptions,
  costCenterOptions,
}: InviteManagerProps) {
  const [invites, setInvites] = useState<InviteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [message, setMessage] = useState<InviteUiMessage | null>(null);

  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roleOptions[0]?.id ?? "");
  const [defaultCostCenterId, setDefaultCostCenterId] = useState("");

  const hasRoles = roleOptions.length > 0;

  async function loadInvites() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/org/invites", { cache: "no-store" });
      const body = (await response.json()) as { data?: InviteListItem[]; code?: string };
      if (!response.ok) {
        setMessage(mapInviteError(body.code));
        setInvites([]);
        emitInviteEvent("list", "failure");
        return;
      }
      setInvites(body.data ?? []);
      emitInviteEvent("list", "success");
    } catch {
      setMessage(mapInviteError());
      setInvites([]);
      emitInviteEvent("list", "failure");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadInvites();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!hasRoles || !email.trim()) {
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    emitInviteEvent("create", "submit");

    try {
      const response = await fetch("/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          roleId,
          defaultCostCenterId: defaultCostCenterId || null,
        }),
      });

      const result = await parseInviteActionResult(response);
      if (!result.ok) {
        setMessage(mapInviteError(result.code));
        emitInviteEvent("create", "failure");
        return;
      }

      setMessage({
        title: "Инвайт отправлен",
        message: "Приглашение создано и отправлено на почту сотрудника.",
        tone: "success",
      });
      setEmail("");
      setDefaultCostCenterId("");
      await loadInvites();
      emitInviteEvent("create", "success");
    } catch {
      setMessage(mapInviteError());
      emitInviteEvent("create", "failure");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runInviteAction(inviteId: string, action: "revoke" | "resend") {
    setActiveActionId(inviteId);
    setMessage(null);
    emitInviteEvent(action, "submit");

    try {
      const response = await fetch(`/api/org/invites/${inviteId}/${action}`, {
        method: "POST",
      });
      const result = await parseInviteActionResult(response);

      if (!result.ok) {
        setMessage(mapInviteError(result.code));
        emitInviteEvent(action, "failure");
        return;
      }

      setMessage({
        title: action === "revoke" ? "Инвайт отозван" : "Инвайт отправлен повторно",
        message:
          action === "revoke"
            ? "Доступ по приглашению немедленно отключен."
            : "Мы отправили новое письмо-приглашение сотруднику.",
        tone: "success",
      });
      await loadInvites();
      emitInviteEvent(action, "success");
    } catch {
      setMessage(mapInviteError());
      emitInviteEvent(action, "failure");
    } finally {
      setActiveActionId(null);
    }
  }

  const sortedInvites = useMemo(
    () => [...invites].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [invites]
  );

  return (
    <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold text-text-main font-display">
            Приглашения с привязкой к почте
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Инвайт привязан к конкретной почте. Это снижает ошибки доступа и делает ротацию
            сотрудников понятной: создайте приглашение, дождитесь принятия, затем при необходимости
            отправьте повторно или отзовите.
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <p className="font-semibold">Когда нужен отзыв</p>
          <p className="mt-1">Если почта ушла не тому человеку или роль поменялась.</p>
        </div>
      </div>

      <MessageBanner message={message} />

      {!hasRoles && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-4 text-sm text-text-secondary">
          Сначала заведите хотя бы одну роль в RBAC, иначе создать приглашение не получится.
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="grid gap-3 md:grid-cols-4"
        aria-label="Создание приглашения"
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="почта@company.ru"
          className="md:col-span-2 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
          required
        />
        <select
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
          className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
          disabled={!hasRoles}
          required
        >
          {!hasRoles && <option value="">Нет доступных ролей</option>}
          {roleOptions.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <select
          value={defaultCostCenterId}
          onChange={(event) => setDefaultCostCenterId(event.target.value)}
          className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
        >
          <option value="">Без центра затрат</option>
          {costCenterOptions.map((center) => (
            <option key={center.id} value={center.id}>
              {center.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="md:col-span-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          disabled={isSubmitting || !hasRoles}
        >
          {isSubmitting ? "Отправляем..." : "Создать и отправить приглашение"}
        </button>
      </form>

      <div className="rounded-xl border border-gray-200 bg-white/60 px-4 py-3 text-xs text-text-secondary">
        <p className="font-semibold text-text-main">Что увидит админ после создания</p>
        <p className="mt-1">
          Свежие приглашения появляются в списке ниже. Отсюда же их можно отправить повторно, если
          письмо не дошло, или отозвать, если доступ больше не нужен.
        </p>
      </div>

      <div className="space-y-2" aria-live="polite">
        {isLoading && (
          <p className="text-xs text-text-secondary">Загружаем активные приглашения...</p>
        )}
        {!isLoading && sortedInvites.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-4">
            <p className="text-sm font-medium text-text-main">Активных приглашений пока нет</p>
            <p className="mt-1 text-xs text-text-secondary">
              Создайте приглашение для нового сотрудника или внешнего подрядчика. После принятия запись
              автоматически исчезнет из этого списка.
            </p>
          </div>
        )}

        {!isLoading &&
          sortedInvites.map((invite) => (
            <div
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
              <div>
                <p className="text-sm font-medium text-text-main">{invite.email}</p>
                <p className="text-xs text-text-secondary">
                  Роль: {invite.role?.name ?? "-"} • Префикс: {invite.tokenPrefix} • Истекает: {" "}
                  {new Date(invite.expiresAt).toLocaleString("ru-RU")}
                </p>
                <p className="mt-1 text-[11px] text-text-secondary">
                  Повторная отправка помогает, если письмо потерялось. Отзыв закрывает приглашение сразу.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white disabled:opacity-60"
                  onClick={() => void runInviteAction(invite.id, "resend")}
                  disabled={activeActionId === invite.id}
                >
                  Повторно отправить
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                  onClick={() => void runInviteAction(invite.id, "revoke")}
                  disabled={activeActionId === invite.id}
                >
                  Отозвать
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
