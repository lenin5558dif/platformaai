import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { auth } from "@/lib/auth";
import { getBillingTier, getBillingTierLabel } from "@/lib/billing-tiers";
import { prisma } from "@/lib/db";
import { getSettingsObject } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

export default async function ImagesPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?mode=register");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      role: true,
      balance: true,
      settings: true,
    },
  });

  const settings = getSettingsObject(user?.settings ?? null);
  const displayName = [
    typeof settings.profileFirstName === "string" ? settings.profileFirstName : "",
    typeof settings.profileLastName === "string" ? settings.profileLastName : "",
  ].filter(Boolean).join(" ");
  const planName = getBillingTierLabel(getBillingTier(user?.settings ?? null, user?.balance));

  return (
    <AppShell
      title="Изображения"
      subtitle="Отдельный инструмент для генерации и истории картинок."
      user={{
        email: user?.email,
        role: user?.role,
        displayName,
        planName,
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-10">
        <section className="overflow-hidden rounded-3xl border border-white/70 bg-[radial-gradient(circle_at_top_left,rgba(212,122,106,0.22),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(250,244,239,0.86))] p-5 shadow-[0_18px_60px_rgba(69,49,40,0.10)] sm:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="mb-3 inline-flex rounded-full border border-primary/20 bg-white/70 px-3 py-1 text-xs font-semibold text-primary">
                Image studio
              </p>
              <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Создавайте изображения отдельно от чата
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
                Здесь будет форма генерации, выбор модели и галерея ваших результатов.
                История сохранится после обновления страницы и будет связана с общим биллингом.
              </p>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/65 p-4 text-sm text-slate-600 shadow-sm">
              <p className="font-semibold text-slate-900">Статус</p>
              <p className="mt-1">Backend API готов. Интерфейс формы подключается следующим шагом.</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Промпт", "Опишите идею, стиль и детали будущего изображения."],
            ["Модель", "На бесплатном тарифе будут доступны только бесплатные image-модели."],
            ["Галерея", "Все успешные генерации появятся здесь с быстрым открытием файла."],
          ].map(([title, text]) => (
            <div
              key={title}
              className="rounded-2xl border border-white/70 bg-white/70 p-5 shadow-sm"
            >
              <h3 className="font-display text-lg font-semibold text-slate-950">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
