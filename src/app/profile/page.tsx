import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import TopUpForm from "@/components/billing/TopUpForm";
import AppShell from "@/components/layout/AppShell";
import TelegramLinkSection from "@/components/profile/TelegramLinkSection";

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
      <div className="mx-auto max-w-3xl rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
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
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Email</p>
            <p className="text-sm font-medium text-text-main">
              {session.user.email ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Telegram ID</p>
            <p className="text-sm font-medium text-text-main">
              {dbUser?.telegramId ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Баланс</p>
            <p className="text-sm font-medium text-text-main">
              {session.user.balance} кредитов
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Роль</p>
            <p className="text-sm font-medium text-text-main">
              {session.user.role}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white/70 p-4">
            <p className="text-xs text-text-secondary">Организация</p>
            <p className="text-sm font-medium text-text-main">
              {session.user.orgId ?? "—"}
            </p>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-gray-200 bg-white/70 p-4">
          <TopUpForm />
        </div>
        <TelegramLinkSection telegramId={dbUser?.telegramId ?? null} />
      </div>
    </AppShell>
  );
}
