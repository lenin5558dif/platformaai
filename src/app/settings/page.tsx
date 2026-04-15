import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import TelegramLinkSection from "@/components/profile/TelegramLinkSection";
import { revalidatePath } from "next/cache";
import { auth, signOut as authSignOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getSettingsObject,
  getUserAssistantInstructions,
  getUserGoal,
  getUserProfile,
  getUserTone,
  mergeSettings,
} from "@/lib/user-settings";

export const dynamic = "force-dynamic";

async function updateProfileSettings(formData: FormData) {
  "use server";
  const session = await auth();

  if (!session?.user?.id) {
    return;
  }

  const redirectTo = String(formData.get("redirectTo") ?? "").trim();

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
  if (redirectTo === "/") {
    redirect("/");
  }
}

async function deleteAccount(formData: FormData) {
  "use server";

  const session = await auth();
  if (!session?.user?.id) {
    return;
  }

  const confirmation = String(formData.get("deleteConfirmation") ?? "")
    .trim()
    .toLowerCase();
  if (confirmation !== "delete" && confirmation !== "удалить") {
    return;
  }

  const userId = session.user.id;

  await prisma.$transaction(async (tx) => {
    await tx.prompt.deleteMany({ where: { createdById: userId } });
    await tx.message.deleteMany({ where: { userId } });
    await tx.attachment.deleteMany({ where: { userId } });
    await tx.chat.deleteMany({ where: { userId } });
    await tx.transaction.deleteMany({ where: { userId } });
    await tx.telegramLinkToken.deleteMany({ where: { userId } });
    await tx.userChannel.deleteMany({ where: { userId } });
    await tx.orgMembership.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });

    await tx.orgInvite.updateMany({
      where: { createdById: userId },
      data: { createdById: null },
    });
    await tx.dlpPolicy.updateMany({
      where: { createdById: userId },
      data: { createdById: null },
    });
    await tx.dlpPolicy.updateMany({
      where: { updatedById: userId },
      data: { updatedById: null },
    });
    await tx.modelPolicy.updateMany({
      where: { createdById: userId },
      data: { createdById: null },
    });
    await tx.modelPolicy.updateMany({
      where: { updatedById: userId },
      data: { updatedById: null },
    });
    await tx.auditLog.updateMany({
      where: { actorId: userId },
      data: { actorId: null },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        email: null,
        telegramId: null,
        orgId: null,
        costCenterId: null,
        role: "USER",
        balance: 0,
        dailySpent: 0,
        monthlySpent: 0,
        settings: {},
        emailVerifiedByProvider: null,
        sessionInvalidatedAt: new Date(),
        globalRevokeCounter: { increment: 1 },
      },
    });
  });

  redirect("/login?deleted=1");
}

async function logout() {
  "use server";
  await authSignOut({ redirectTo: "/login" });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ onboarding?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const isOnboardingFlow = params?.onboarding === "1";
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-slate-200 p-6 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900 mb-2 font-display">
            Настройки недоступны
          </h1>
          <p className="text-sm text-slate-500">Пожалуйста, войдите в аккаунт.</p>
        </div>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true, email: true, role: true, telegramId: true },
  });

  const settings = getSettingsObject(user?.settings ?? null);
  const userProfile = getUserProfile(user?.settings ?? null) ?? "";
  const userGoal = getUserGoal(user?.settings ?? null) ?? "";
  const userTone = getUserTone(user?.settings ?? null) ?? "";
  const assistantInstructions =
    getUserAssistantInstructions(user?.settings ?? null) ?? "";

  const firstName =
    typeof settings.profileFirstName === "string" ? settings.profileFirstName : "";
  const lastName =
    typeof settings.profileLastName === "string" ? settings.profileLastName : "";
  const headline =
    typeof settings.profileHeadline === "string" ? settings.profileHeadline : "";
  const phone =
    typeof settings.profilePhone === "string" ? settings.profilePhone : "";

  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  const planName =
    typeof settings.planName === "string" ? settings.planName : "Тариф Pro";

  return (
    <AppShell
      title="Настройки"
      subtitle="Личный профиль и предпочтения."
      user={{
        email: user?.email,
        role: user?.role,
        displayName,
        planName,
      }}
      showSidebar={false}
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
          <form action={logout}>
            <button
              type="submit"
              className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white"
            >
              Выйти из аккаунта
            </button>
          </form>
        </div>

          <form id="profile-form" action={updateProfileSettings} className="space-y-6">
            <input
              type="hidden"
              name="redirectTo"
              value={isOnboardingFlow ? "/" : ""}
            />
            {isOnboardingFlow && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text-main">
                Заполните профиль и нажмите «Сохранить изменения», чтобы перейти в чат.
              </div>
            )}
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
                    <Link
                      href="/profile"
                      className="absolute bottom-0 right-0 rounded-full border border-gray-200 bg-white p-1.5 text-slate-900 shadow-md transition-colors hover:text-primary"
                    >
                      <span className="material-symbols-outlined text-[16px] block">
                        edit
                      </span>
                    </Link>
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
                        placeholder="Например: менеджер продукта"
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
                    Email адрес
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
              id="telegram"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-200/60 px-8 py-6">
                <h3 className="text-base font-bold text-slate-900">
                  Telegram
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Подключите Telegram, чтобы входить через бота и пользоваться Telegram-каналом.
                </p>
              </div>
              <div className="p-8">
                <TelegramLinkSection telegramId={user?.telegramId ?? null} />
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

          {user?.role === "ADMIN" && (
            <section
              id="admin-panel"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="border-b border-slate-200/60 px-8 py-6">
                <h3 className="text-base font-bold text-slate-900">Админ-панель</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Управление пользователями, ключами провайдеров и мониторингом системы.
                </p>
              </div>
              <div className="p-8">
                <Link
                  href="/admin"
                  className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                >
                  Перейти в админ-панель
                </Link>
              </div>
            </section>
          )}

          <form
            id="danger-zone"
            action={deleteAccount}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="border-b border-slate-200/60 px-8 py-6">
              <h3 className="text-base font-bold text-slate-900">Опасная зона</h3>
            </div>
            <div className="flex flex-col gap-4 p-8">
              <div>
                <p className="text-sm font-medium text-slate-900">Удалить аккаунт</p>
                <p className="text-xs text-slate-500">
                  Введите DELETE или УДАЛИТЬ для подтверждения. Действие необратимо.
                </p>
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  name="deleteConfirmation"
                  type="text"
                  required
                  className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 md:max-w-xs"
                  placeholder="Введите DELETE"
                />
                <button
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100"
                  type="submit"
                >
                  Удалить аккаунт
                </button>
              </div>
            </div>
          </form>
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
