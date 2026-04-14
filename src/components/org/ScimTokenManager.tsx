"use client";

import { useEffect, useState } from "react";

type ScimToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

export default function ScimTokenManager() {
  const [tokens, setTokens] = useState<ScimToken[]>([]);
  const [name, setName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  function formatDate(value?: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ru-RU");
  }

  async function loadTokens() {
    try {
      const response = await fetch("/api/scim/tokens");
      const data = await response.json();
      setTokens(data?.data ?? []);
    } catch {
      setTokens([]);
    }
  }

  useEffect(() => {
    void loadTokens();
  }, []);

  async function createToken() {
    if (!name.trim()) return;
    setStatus("loading");
    setCreatedToken(null);
    try {
      const response = await fetch("/api/scim/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      const data = await response.json();
      setCreatedToken(data?.data?.token ?? null);
      setName("");
      await loadTokens();
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function revokeToken(id: string) {
    await fetch("/api/scim/tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadTokens();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-700">
        <p className="font-semibold">SCIM нужен для provisioning</p>
        <p className="mt-1">
          Используйте токен, чтобы синхронизировать пользователей и группы из IdP. Новый токен
          показывается один раз, затем хранится только в вашем менеджере секретов.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-text-secondary">Название токена</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
            placeholder="Okta / Azure"
          />
        </div>
        <button
          type="button"
          onClick={createToken}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          disabled={status === "loading"}
        >
          Создать токен
        </button>
      </div>

      {createdToken && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <p className="font-semibold">Новый SCIM токен</p>
          <p className="mt-1 break-all font-mono text-xs">{createdToken}</p>
          <p className="mt-2 text-xs text-emerald-700/80">
            Сохраните токен сейчас — он показывается только один раз.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {tokens.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-4">
            <p className="text-sm font-medium text-text-main">Токены еще не созданы</p>
            <p className="mt-1 text-xs text-text-secondary">
              Создайте первый токен, если будете подключать Okta, Azure AD или другой IdP.
            </p>
          </div>
        )}
        {tokens.map((token) => (
          <div
            key={token.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-text-main">{token.name}</p>
              <p className="text-xs text-text-secondary">
                Префикс: {token.tokenPrefix} • Последнее использование: {formatDate(token.lastUsedAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => revokeToken(token.id)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white"
            >
              Отозвать
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
