import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { revalidatePath } from "next/cache";
import { auth, requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getSettingsObject,
  getUserAssistantInstructions,
  getUserGoal,
  getUserOpenRouterKey,
  getUserProfile,
  getUserTone,
  mergeSettings,
  removeSettingsKey,
} from "@/lib/user-settings";
import { resolvePlanFromSettings } from "@/lib/plans";

export const dynamic = "force-dynamic";

async function updateOpenRouterKey(formData: FormData) {
  "use server";
  const session = await auth();

  if (!session?.user?.id) {
    return;
  }

  const allowUserKey =
    process.env.AUTH_BYPASS === "1" ||
    process.env.ALLOW_USER_OPENROUTER_KEYS === "1";
  if (!allowUserKey) {
    return;
  }

  const apiKey = String(formData.get("openrouterApiKey") ?? "").trim();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true },
  });

  if (!user) return;

  const nextSettings = apiKey
    ? mergeSettings(user.settings, { openrouterApiKey: apiKey })
    : removeSettingsKey(user.settings, "openrouterApiKey");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { settings: nextSettings },
  });

  revalidatePath("/settings");
}

async function updateProfileSettings(formData: FormData) {
  "use server";
  const session = await auth();

  if (!session?.user?.id) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true },
  });

  if (!user) return;

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const userProfile = String(formData.get("userProfile") ?? "").trim();
  const userGoal = String(formData.get("userGoal") ?? "").trim();
  const userTone = String(formData.get("userTone") ?? "").trim();
  const assistantInstructions = String(
    formData.get("assistantInstructions") ?? ""
  ).trim();

  const nextSettings = mergeSettings(user.settings, {
    profileFirstName: firstName,
    profileLastName: lastName,
    profileHeadline: headline,
    profilePhone: phone,
    userProfile,
    userGoal,
    userTone,
    assistantInstructions,
    onboarded: true,
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { settings: nextSettings },
  });

  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const session = await requirePageSession();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true, email: true, role: true },
  });

  const settings = getSettingsObject(user?.settings ?? null);
  const openRouterKey = getUserOpenRouterKey(user?.settings ?? null);
  const userProfile = getUserProfile(user?.settings ?? null) ?? "";
  const userGoal = getUserGoal(user?.settings ?? null) ?? "";
  const userTone = getUserTone(user?.settings ?? null) ?? "";
  const assistantInstructions =
    getUserAssistantInstructions(user?.settings ?? null) ?? "";
  const allowUserKey =
    process.env.AUTH_BYPASS === "1" ||
    process.env.ALLOW_USER_OPENROUTER_KEYS === "1";

  const firstName =
    typeof settings.profileFirstName === "string" ? settings.profileFirstName : "";
  const lastName =
    typeof settings.profileLastName === "string" ? settings.profileLastName : "";
  const headline =
    typeof settings.profileHeadline === "string" ? settings.profileHeadline : "";
  const phone =
    typeof settings.profilePhone === "string" ? settings.profilePhone : "";

  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  const planName = resolvePlanFromSettings(settings)?.name ?? "Тариф не назначен";

  return (
    <AppShell
      title="Настройки"
      subtitle="Личный профиль, предпочтения и ключи доступа."
      user={{
        email: user?.email,
        role: user?.role,
        displayName,
        planName,
      }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10">
        <div className="mb-2 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              Общие настройки
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Управляйте личной информацией и основными предпочтениями.
            </p>
          </div>
          <Link
            className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white"
            href="/"
          >
            В чат
          </Link>
        </div>

          <form id="profile-form" action={updateProfileSettings} className="space-y-6">
            <section
              id="general"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-200/60 px-8 py-6">
                <h3 className="text-base font-bold text-slate-900">
                  Личная информация
                </h3>
                <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-mono text-slate-500">
                  ID: {session.user.id.slice(0, 8)}
                </span>
              </div>
              <div className="p-8">
                <div className="flex flex-col items-start gap-8 sm:flex-row">
                  <div className="relative shrink-0">
                    <div className="flex size-24 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary ring-4 ring-gray-50">
                      {user?.email?.[0]?.toUpperCase() ?? "U"}
                    </div>
                    <button
                      className="absolute bottom-0 right-0 rounded-full border border-gray-200 bg-slate-100 p-1.5 text-slate-400 shadow-md"
                      disabled
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px] block">
                        edit
                      </span>
                    </button>
                  </div>
                  <div className="grid w-full grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                        htmlFor="firstName"
                      >
                        Имя
                      </label>
                      <input
                        id="firstName"
                        name="firstName"
                        defaultValue={firstName}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                        type="text"
                        placeholder="Ваше имя"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                        htmlFor="lastName"
                      >
                        Фамилия
                      </label>
                      <input
                        id="lastName"
                        name="lastName"
                        defaultValue={lastName}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                        type="text"
                        placeholder="Ваша фамилия"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label
                        className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                        htmlFor="headline"
                      >
                        Должность / Заголовок
                      </label>
                      <input
                        id="headline"
                        name="headline"
                        defaultValue={headline}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                        type="text"
                        placeholder="Например: Менеджер продукта"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Отображается в публичном профиле и командах.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200/60 px-8 py-6">
                <h3 className="text-base font-bold text-slate-900">
                  Контактная информация
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-6 p-8 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                    htmlFor="email"
                  >
                    Email-адрес
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 text-[18px] text-gray-400 -translate-y-1/2">
                      mail
                    </span>
                    <input
                      id="email"
                      readOnly
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-3 py-2.5 text-sm text-slate-900 outline-none"
                      type="email"
                      value={user?.email ?? ""}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label
                    className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                    htmlFor="phone"
                  >
                    Телефон
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 text-[18px] text-gray-400 -translate-y-1/2">
                      call
                    </span>
                    <input
                      id="phone"
                      name="phone"
                      defaultValue={phone}
                      className="w-full rounded-lg border border-gray-200 bg-white pl-10 pr-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                      type="tel"
                      placeholder="+7 900 000 00 00"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section
              id="preferences"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-200/60 px-8 py-6">
                <h3 className="text-base font-bold text-slate-900">
                  Предпочтения
                </h3>
              </div>
              <div className="p-8 space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Цель
                    </label>
                    <select
                      name="userGoal"
                      defaultValue={userGoal}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
                    >
                      <option value="">Не выбрано</option>
                      <option value="Учёба и обучение">Учёба и обучение</option>
                      <option value="Рабочие задачи">Рабочие задачи</option>
                      <option value="Бизнес/стартап">Бизнес/стартап</option>
                      <option value="Креатив и идеи">Креатив и идеи</option>
                      <option value="Программирование">Программирование</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Тон общения
                    </label>
                    <select
                      name="userTone"
                      defaultValue={userTone}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
                    >
                      <option value="">По умолчанию</option>
                      <option value="Коротко и по делу">Коротко и по делу</option>
                      <option value="Дружелюбно и подробно">Дружелюбно и подробно</option>
                      <option value="Формально и структурно">Формально и структурно</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Профиль пользователя
                  </label>
                  <textarea
                    name="userProfile"
                    defaultValue={userProfile}
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                    placeholder="Кто вы, чем занимаетесь, какие предпочтения?"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Инструкции ассистенту
                  </label>
                  <textarea
                    name="assistantInstructions"
                    defaultValue={assistantInstructions}
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                    placeholder="Например: отвечай списком, давай ссылки, уточняй вопросы."
                  />
                </div>
              </div>
            </section>
          </form>

          <section
            id="api-keys"
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="border-b border-slate-200/60 px-8 py-6">
              <h3 className="text-base font-bold text-slate-900">API ключи</h3>
              <p className="mt-1 text-xs text-slate-500">
                {allowUserKey
                  ? "Ключ хранится в настройках пользователя и используется для запросов в чате."
                  : "Сейчас используется ключ из .env. Чтобы включить пользовательские ключи, установите ALLOW_USER_OPENROUTER_KEYS=1."}
              </p>
            </div>
            <div className="p-8">
              <form action={updateOpenRouterKey} className="space-y-4">
                <input
                  name="openrouterApiKey"
                  type="password"
                  autoComplete="off"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                  placeholder={
                    openRouterKey
                      ? `Сохранен ключ ••••${openRouterKey.slice(-4)}`
                      : "Вставьте ключ OpenRouter"
                  }
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                    disabled={!allowUserKey}
                  >
                    Сохранить ключ
                  </button>
                  <Link
                    className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
                    href="/"
                  >
                    Перейти в чат
                  </Link>
                  <button
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-gray-50 disabled:opacity-60"
                    name="openrouterApiKey"
                    value=""
                    disabled={!allowUserKey}
                  >
                    Очистить
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200/60 px-8 py-6">
              <h3 className="text-base font-bold text-slate-900">Опасная зона</h3>
            </div>
            <div className="flex flex-col gap-4 p-8 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">Удалить аккаунт</p>
                <p className="text-xs text-slate-500">
                  Удаление аккаунта необратимо и станет доступно после отдельного confirm-flow.
                </p>
              </div>
              <button
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-300"
                disabled
                type="button"
              >
                Скоро
              </button>
            </div>
          </section>
          <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-white/50 bg-white/80 px-5 py-4 text-sm text-slate-500 sm:flex-row sm:items-center">
            <span>Изменения сохраняются после подтверждения.</span>
            <button
              form="profile-form"
              type="submit"
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Сохранить изменения
            </button>
          </div>
        </div>
      </AppShell>
  );
}
