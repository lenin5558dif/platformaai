import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import AppShell from "@/components/layout/AppShell";
import TopUpForm from "@/components/billing/TopUpForm";
import { auth, signOut as authSignOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getBillingTier, getBillingTierLabel } from "@/lib/billing-tiers";
import { issueEmailVerificationToken } from "@/lib/email-verification";
import { sendEmailVerificationEmail } from "@/lib/unisender";
import {
  getSettingsObject,
  getUserAssistantInstructions,
  getUserGoal,
  getUserProfile,
  getUserTone,
  mergeSettings,
} from "@/lib/user-settings";

export const dynamic = "force-dynamic";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Введите корректный email");

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

  redirect("/settings?profile=saved");
}

async function updateContactSettings(formData: FormData) {
  "use server";
  const session = await auth();

  if (!session?.user?.id) {
    return;
  }

  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      settings: true,
      emailVerifiedByProvider: true,
    },
  });

  if (!user) {
    return;
  }

  let normalizedEmail: string | null = user.email;

  if (emailRaw) {
    const parsed = emailSchema.safeParse(emailRaw);
    if (!parsed.success) {
      redirect("/settings?contact=invalid_email");
    }
    normalizedEmail = parsed.data;
  } else if (!user.email) {
    normalizedEmail = null;
  } else {
    redirect("/settings?contact=email_required");
  }

  if (normalizedEmail && normalizedEmail !== user.email) {
    const existingUser = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        NOT: { id: user.id },
      },
      select: { id: true },
    });

    if (existingUser) {
      redirect("/settings?contact=email_taken");
    }
  }

  const nextSettings = mergeSettings(user.settings, {
    profilePhone: phone,
  });
  const emailChanged = normalizedEmail !== user.email;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email: normalizedEmail,
      settings: nextSettings,
      emailVerifiedByProvider:
        normalizedEmail === null
          ? null
          : emailChanged
            ? false
            : user.emailVerifiedByProvider,
    },
  });

  revalidatePath("/settings");

  if (normalizedEmail && emailChanged) {
    try {
      const token = await issueEmailVerificationToken({
        userId: user.id,
        email: normalizedEmail,
      });

      await sendEmailVerificationEmail({
        email: normalizedEmail,
        verificationUrl: token.verificationUrl,
      });

      redirect("/settings?verification=sent");
    } catch {
      redirect("/settings?verification=send_failed");
    }
  }

  redirect("/settings?contact=saved");
}

async function resendVerificationEmail() {
  "use server";
  const session = await auth();

  if (!session?.user?.id) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      emailVerifiedByProvider: true,
    },
  });

  if (!user?.email) {
    redirect("/settings?verification=email_required");
  }

  if (user.emailVerifiedByProvider === true) {
    redirect("/settings?verification=already_verified");
  }

  try {
    const token = await issueEmailVerificationToken({
      userId: user.id,
      email: user.email,
    });

    await sendEmailVerificationEmail({
      email: user.email,
      verificationUrl: token.verificationUrl,
    });

    redirect("/settings?verification=sent");
  } catch {
    redirect("/settings?verification=send_failed");
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
    await tx.verificationToken.deleteMany({
      where: {
        identifier: {
          startsWith: `email-verify:${userId}:`,
        },
      },
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

function mapVerificationMessage(state?: string) {
  switch (state) {
    case "sent":
      return {
        tone: "info" as const,
        text: "Письмо для подтверждения отправлено.",
      };
    case "verified":
      return {
        tone: "success" as const,
        text: "Email подтвержден.",
      };
    case "expired":
      return {
        tone: "error" as const,
        text: "Ссылка для подтверждения устарела. Отправьте письмо еще раз.",
      };
    case "invalid":
      return {
        tone: "error" as const,
        text: "Ссылка подтверждения недействительна.",
      };
    case "send_failed":
      return {
        tone: "error" as const,
        text: "Не удалось отправить письмо подтверждения. Проверьте почтовые настройки.",
      };
    case "email_required":
      return {
        tone: "error" as const,
        text: "Сначала добавьте email.",
      };
    case "already_verified":
      return {
        tone: "success" as const,
        text: "Этот email уже подтвержден.",
      };
    default:
      return null;
  }
}

function mapContactMessage(state?: string) {
  switch (state) {
    case "saved":
      return {
        tone: "success" as const,
        text: "Контактные данные сохранены.",
      };
    case "invalid_email":
      return {
        tone: "error" as const,
        text: "Введите корректный email.",
      };
    case "email_taken":
      return {
        tone: "error" as const,
        text: "Этот email уже используется.",
      };
    case "email_required":
      return {
        tone: "error" as const,
        text: "Email нельзя оставить пустым.",
      };
    default:
      return null;
  }
}

function messageToneClass(tone: "info" | "success" | "error") {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (tone === "error") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    onboarding?: string;
    success?: string;
    canceled?: string;
    verification?: string;
    contact?: string;
    profile?: string;
  }>;
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
    select: {
      id: true,
      settings: true,
      email: true,
      telegramId: true,
      role: true,
      balance: true,
      emailVerifiedByProvider: true,
    },
  });

  const settings = getSettingsObject(user?.settings ?? null);
  const userTier = getBillingTier(user?.settings ?? null, user?.balance);
  const userTierLabel = getBillingTierLabel(userTier);
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
  const planName = userTierLabel;
  const verificationMessage = mapVerificationMessage(params?.verification);
  const contactMessage = mapContactMessage(params?.contact);
  const profileSaved = params?.profile === "saved";
  const emailVerified = user?.emailVerifiedByProvider === true;
  const needsEmail = !user?.email;
  const needsVerification = Boolean(user?.email) && !emailVerified;
  const purchaseBlocked = needsEmail || needsVerification;
  const topUpNotice = needsEmail
    ? "Добавьте email, чтобы купить тариф."
    : needsVerification
      ? "Подтвердите email, чтобы купить тариф."
      : null;

  return (
    <AppShell
      title="Настройки"
      subtitle="Профиль, контакты и оплата."
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
              Настройки аккаунта
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Здесь собраны профиль, контакты и оплата.
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

        {params?.success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            Оплата прошла успешно. Баланс обновится после подтверждения платежа.
          </div>
        )}
        {params?.canceled && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
            Платеж отменен.
          </div>
        )}
        {verificationMessage && (
          <div
            className={`rounded-lg border px-4 py-2 text-sm ${messageToneClass(
              verificationMessage.tone
            )}`}
          >
            {verificationMessage.text}
          </div>
        )}
        {contactMessage && (
          <div
            className={`rounded-lg border px-4 py-2 text-sm ${messageToneClass(
              contactMessage.tone
            )}`}
          >
            {contactMessage.text}
          </div>
        )}
        {profileSaved && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            Изменения сохранены.
          </div>
        )}
        {(needsEmail || needsVerification) && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            {needsEmail
              ? "Добавьте email. Он понадобится для покупки тарифа."
              : "Подтвердите email. Без этого покупка тарифа недоступна."}
          </div>
        )}
        {isOnboardingFlow && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text-main">
            Заполните данные и сохраните изменения, чтобы перейти в чат.
          </div>
        )}

        <form id="profile-form" action={updateProfileSettings} className="space-y-6">
          <input
            type="hidden"
            name="redirectTo"
            value={isOnboardingFlow ? "/" : ""}
          />

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200/60 px-8 py-6">
              <h3 className="text-base font-bold text-slate-900">Профиль</h3>
              <span className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-mono text-slate-500">
                ID: {session.user.id.slice(0, 8)}
              </span>
            </div>
            <div className="p-8">
              <div className="flex flex-col items-start gap-8 sm:flex-row">
                <div className="flex size-24 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary ring-4 ring-gray-50">
                  {user?.email?.[0]?.toUpperCase() ?? "U"}
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
                      О себе
                    </label>
                    <input
                      id="headline"
                      name="headline"
                      defaultValue={headline}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                      type="text"
                      placeholder="Чем вы занимаетесь"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">Тариф</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {planName}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">Баланс</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {user?.balance?.toString() ?? "0"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">Email</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {emailVerified ? "Подтвержден" : "Нужна проверка"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">Telegram</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {user?.telegramId ? "Подключен" : "Не подключен"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200/60 px-8 py-6">
              <h3 className="text-base font-bold text-slate-900">Предпочтения</h3>
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
                  placeholder="Кто вы и для чего используете сервис"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Пожелания к ответам
                </label>
                <textarea
                  name="assistantInstructions"
                  defaultValue={assistantInstructions}
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                  placeholder="Например: отвечай коротко и структурно"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                Сохранить изменения
              </button>
            </div>
          </section>
        </form>

        <form
          action={updateContactSettings}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-200/60 px-8 py-6">
            <h3 className="text-base font-bold text-slate-900">Контакты</h3>
          </div>
          <div className="grid grid-cols-1 gap-6 p-8 md:grid-cols-2">
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                htmlFor="email"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                defaultValue={user?.email ?? ""}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                type="email"
                placeholder="name@example.com"
              />
              <div className="text-xs text-slate-500">
                {emailVerified ? "Email подтвержден" : "Email не подтвержден"}
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider text-slate-500"
                htmlFor="phone"
              >
                Телефон
              </label>
              <input
                id="phone"
                name="phone"
                defaultValue={phone}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/10"
                type="tel"
                placeholder="+7 900 000 00 00"
              />
            </div>
            <div className="md:col-span-2 flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                Сохранить контакты
              </button>
              {!emailVerified && user?.email && (
                <button
                  type="submit"
                  formAction={resendVerificationEmail}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Отправить письмо еще раз
                </button>
              )}
            </div>
          </div>
        </form>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200/60 px-8 py-6">
            <h3 className="text-base font-bold text-slate-900">Пополнение</h3>
          </div>
          <div className="space-y-4 p-8">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">Текущий тариф</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{planName}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">Баланс</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {user?.balance?.toString() ?? "0"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">Telegram</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {user?.telegramId ?? "Не подключен"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">Статус email</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {emailVerified ? "Подтвержден" : "Требуется подтверждение"}
                </p>
              </div>
            </div>
            <TopUpForm disabled={purchaseBlocked} notice={topUpNotice} />
          </div>
        </section>

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
                Введите DELETE или УДАЛИТЬ для подтверждения.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                name="deleteConfirmation"
                type="text"
                required
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 md:max-w-xs"
                placeholder="DELETE"
              />
              <button
                type="submit"
                className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100"
              >
                Удалить аккаунт
              </button>
            </div>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
