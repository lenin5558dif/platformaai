import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import TopUpForm from "@/components/billing/TopUpForm";
import AppShell from "@/components/layout/AppShell";
import TelegramLinkSection from "@/components/profile/TelegramLinkSection";
import SessionSecurityCard from "@/components/profile/SessionSecurityCard";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ success?: string; canceled?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Профиль недоступен
          </h1>
          <p className="text-sm text-text-secondary">
            Пожалуйста, войдите в аккаунт.
          </p>
        </div>
      </div>
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { telegramId: true },
  });


  return (
    <AppShell
      title="Профиль"
      subtitle="Управляйте аккаунтом и привяжите Telegram."
      user={{
        email: session.user.email,
        role: session.user.role,
        planName: "Pro Plan",
      }}
    >
      <div className="mx-auto max-w-4xl space-y-4">
        {resolvedParams?.success && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
            Оплата прошла успешно. Баланс будет обновлён после подтверждения.
          </div>
        )}
        {resolvedParams?.canceled && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            Платёж отменён. Вы можете попробовать снова.
          </div>
        )}
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
                Account control
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-text-main font-display">
                Всё для повседневного аккаунта в одном месте
              </h1>
              <p className="mt-2 text-sm text-text-secondary">
                Здесь проверяются баланс, Telegram и базовый статус доступа. Для управления
                сотрудниками, ролями и сессиями организации используйте раздел организации.
              </p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700">
              <p className="font-semibold">Безопасность доступа</p>
              <p className="mt-1">Свои сессии можно завершить здесь, чужие — через org center.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
              <p className="text-xs text-text-secondary">Email</p>
              <p className="mt-1 text-sm font-medium text-text-main">
                {session.user.email ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
              <p className="text-xs text-text-secondary">Telegram ID</p>
              <p className="mt-1 text-sm font-medium text-text-main">
                {dbUser?.telegramId ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
              <p className="text-xs text-text-secondary">Баланс</p>
              <p className="mt-1 text-sm font-medium text-text-main">
                {session.user.balance} кредитов
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
              <p className="text-xs text-text-secondary">Роль</p>
              <p className="mt-1 text-sm font-medium text-text-main">{session.user.role}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
              Org: {session.user.orgId ?? "без org"}
            </span>
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
              Telegram: {dbUser?.telegramId ? "linked" : "not linked"}
            </span>
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
              Profile actions: top up, Telegram, billing
            </span>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
              <TopUpForm />
            </div>
            <div className="space-y-4">
              <SessionSecurityCard />
              <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
                <p className="text-sm font-medium text-text-main">Где управлять доступом</p>
                <p className="mt-2 text-xs text-text-secondary">
                  Роли, invites, cost centers и отзыв сессий участников находятся в организационном центре.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href="/org"
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
                  >
                    Открыть org
                  </Link>
                  <Link
                    href="/admin"
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white"
                  >
                    Админ-обзор
                  </Link>
                </div>
                <p className="mt-3 text-[11px] text-text-secondary">
                  Администратор может завершать активные сессии участников из карточки RBAC.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <TelegramLinkSection telegramId={dbUser?.telegramId ?? null} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
