import { ProviderType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminActor } from "@/lib/admin-auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getOpenRouterBaseUrl, getOpenRouterHeaders } from "@/lib/openrouter";
import {
  getOrgProviderCredential,
  upsertOrgProviderCredential,
  resolveProviderSecret,
} from "@/lib/provider-credentials";
import { maskSecretByFingerprint } from "@/lib/secret-crypto";
import { getPlatformConfig, updatePlatformConfig } from "@/lib/platform-config";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

export const dynamic = "force-dynamic";

function parseModelList(raw: string) {
  return raw
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function updatePlatformSettings(formData: FormData) {
  "use server";
  const admin = await requireAdminActor();
  const globalSystemPrompt = String(formData.get("globalSystemPrompt") ?? "");
  const disabledModelsRaw = String(formData.get("disabledModelIds") ?? "");
  const disabledModelIds = parseModelList(disabledModelsRaw);

  await updatePlatformConfig({
    globalSystemPrompt,
    disabledModelIds,
    updatedById: admin.id,
  });

  await logAudit({
    action: "PLATFORM_SYSTEM_PROMPT_UPDATED",
    orgId: null,
    actorId: admin.id,
    targetType: "platform",
    targetId: "default",
    metadata: {
      hasPrompt: globalSystemPrompt.trim().length > 0,
      disabledModelsCount: disabledModelIds.length,
    },
  });

  revalidatePath("/admin/api-routing");
}

async function saveOrgOpenRouterCredential(orgId: string, formData: FormData) {
  "use server";
  const admin = await requireAdminActor();
  const rawSecret = String(formData.get("apiKey") ?? "");
  const isActive = String(formData.get("isActive")) === "true";

  const existing = await getOrgProviderCredential({
    orgId,
    provider: ProviderType.OPENROUTER,
  });

  if (rawSecret.trim()) {
    await upsertOrgProviderCredential({
      orgId,
      provider: ProviderType.OPENROUTER,
      rawSecret,
      isActive,
      updatedById: admin.id,
    });
  } else if (existing) {
    await prisma.orgProviderCredential.update({
      where: { id: existing.id },
      data: {
        isActive,
        updatedById: admin.id,
      },
    });
  } else {
    return;
  }

  await logAudit({
    action: "ORG_PROVIDER_CREDENTIAL_UPDATED",
    orgId,
    actorId: admin.id,
    targetType: "provider_credential",
    targetId: orgId,
    metadata: {
      provider: "OPENROUTER",
      isActive,
      changedSecret: rawSecret.trim().length > 0,
    },
  });

  revalidatePath("/admin/api-routing");
}

async function testOrgOpenRouterCredential(orgId: string) {
  "use server";
  await requireAdminActor();

  const apiKey = await resolveProviderSecret({
    orgId,
    provider: ProviderType.OPENROUTER,
  });

  if (!apiKey) {
    redirect(
      `/admin/api-routing?status=${encodeURIComponent("missing_key")}&orgId=${encodeURIComponent(
        orgId
      )}`
    );
  }

  try {
    const response = await fetchWithTimeout(`${getOpenRouterBaseUrl()}/models`, {
      headers: getOpenRouterHeaders(apiKey ?? undefined),
      cache: "no-store",
      timeoutMs: 12_000,
      timeoutLabel: "OpenRouter models",
    });
    const status = response.ok ? "ok" : "failed";
    redirect(
      `/admin/api-routing?status=${encodeURIComponent(status)}&orgId=${encodeURIComponent(
        orgId
      )}`
    );
  } catch {
    redirect(
      `/admin/api-routing?status=${encodeURIComponent("failed")}&orgId=${encodeURIComponent(
        orgId
      )}`
    );
  }
}

export default async function AdminApiRoutingPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; orgId?: string }>;
}) {
  await requireAdminActor();

  const params = searchParams ? await searchParams : undefined;
  const platformConfig = await getPlatformConfig();
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
    },
  });

  const credentials = await prisma.orgProviderCredential.findMany({
    where: { provider: ProviderType.OPENROUTER },
    select: {
      id: true,
      orgId: true,
      provider: true,
      isActive: true,
      secretFingerprint: true,
      updatedAt: true,
    },
  });
  const credentialByOrg = new Map(credentials.map((entry) => [entry.orgId, entry]));

  const statusOrgId = (params?.orgId ?? "").trim();
  const statusRaw = (params?.status ?? "").trim();
  const statusText =
    statusRaw === "ok"
      ? "Проверка ключа успешна."
      : statusRaw === "missing_key"
      ? "Ключ не найден или отключен."
      : statusRaw === "failed"
      ? "Проверка ключа завершилась с ошибкой."
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Маршрутизация API-ключей
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Подключение провайдеров (OpenRouter), системный промпт и глобальные
          ограничения моделей.
        </p>
      </div>

      {statusText && (
        <div className="rounded-xl border border-gray-200 bg-white/80 p-4 text-sm text-text-main">
          {statusText}
          {statusOrgId && <span className="text-text-secondary"> (org: {statusOrgId})</span>}
        </div>
      )}

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h2 className="text-lg font-semibold text-text-main font-display">
          Глобальные настройки платформы
        </h2>
        <form action={updatePlatformSettings} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              Системный промпт (глобальный)
            </label>
            <textarea
              name="globalSystemPrompt"
              defaultValue={platformConfig.globalSystemPrompt ?? ""}
              rows={6}
              className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Введите глобальные инструкции для всех AI-запросов"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              Глобально отключенные модели
            </label>
            <textarea
              name="disabledModelIds"
              defaultValue={platformConfig.disabledModelIds.join("\n")}
              rows={4}
              className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="openai/gpt-4o-mini&#10;anthropic/claude-3.5-sonnet"
            />
            <p className="mt-1 text-xs text-text-secondary">
              По одной модели в строке или через запятую.
            </p>
          </div>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
            Сохранить глобальные настройки
          </button>
        </form>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h2 className="text-lg font-semibold text-text-main font-display">
          OpenRouter ключи организаций
        </h2>
        <div className="mt-4 space-y-3">
          {organizations.map((org) => {
            const credential = credentialByOrg.get(org.id);
            return (
              <div
                key={org.id}
                className="rounded-xl border border-gray-200 bg-white/70 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-text-main">{org.name}</p>
                    <p className="text-xs text-text-secondary">
                      Статус:{" "}
                      {credential?.isActive ? (
                        <span className="text-emerald-700">активен</span>
                      ) : (
                        <span className="text-rose-700">не настроен / отключен</span>
                      )}{" "}
                      • fingerprint: {maskSecretByFingerprint(credential?.secretFingerprint)}
                    </p>
                  </div>
                  <form action={testOrgOpenRouterCredential.bind(null, org.id)}>
                    <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold hover:bg-white">
                      Проверить ключ
                    </button>
                  </form>
                </div>
                <form
                  action={saveOrgOpenRouterCredential.bind(null, org.id)}
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  <div className="min-w-[280px] flex-1">
                    <label className="block text-xs text-text-secondary mb-1">
                      Новый API ключ OpenRouter
                    </label>
                    <input
                      name="apiKey"
                      type="password"
                      className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="sk-or-..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">Активность</label>
                    <select
                      name="isActive"
                      defaultValue={credential?.isActive ? "true" : "false"}
                      className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
                    >
                      <option value="true">Включен</option>
                      <option value="false">Отключен</option>
                    </select>
                  </div>
                  <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
                    Сохранить
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
