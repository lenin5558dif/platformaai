import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateToken } from "@/lib/tokens";
import TopUpForm from "@/components/billing/TopUpForm";
import AppShell from "@/components/layout/AppShell";

export const dynamic = "force-dynamic";

async function createTelegramToken() {
  "use server";
  const session = await auth();

  if (!session?.user?.id) {
    return;
  }

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.telegramLinkToken.deleteMany({
    where: { userId: session.user.id },
  });

  await prisma.telegramLinkToken.create({
    data: {
      token: generateToken(),
      userId: session.user.id,
      expiresAt,
    },
  });

  revalidatePath("/profile");
}

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

  const tokenRecord = await prisma.telegramLinkToken.findFirst({
    where: {
      userId: session.user.id,
      expiresAt: { gt: new Date() },
      usedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  const botName = process.env.TELEGRAM_LOGIN_BOT_NAME ?? "platformaai_bot";
  const deepLink = tokenRecord
    ? `https://t.me/${botName}?start=${tokenRecord.token}`
    : null;

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
        <div className="mt-6 rounded-xl border border-gray-200 bg-white/70 p-4">
          <p className="text-sm font-medium text-text-main mb-2">
            Привязка Telegram
          </p>
          <p className="text-xs text-text-secondary mb-3">
            Сгенерируйте токен и перейдите по ссылке, чтобы связать аккаунт.
          </p>
          {deepLink ? (
            <div className="mb-3 text-xs text-text-main">
              <span className="font-medium">Deep link:</span>{" "}
              <a className="text-primary underline" href={deepLink}>
                {deepLink}
              </a>
            </div>
          ) : (
            <p className="text-xs text-text-secondary mb-3">
              Активных токенов нет.
            </p>
          )}
          <form action={createTelegramToken}>
            <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
              Сгенерировать ссылку
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
