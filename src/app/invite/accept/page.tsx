import Link from "next/link";
import InviteAcceptanceCard from "@/components/org/InviteAcceptanceCard";

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const token = params?.token ?? "";

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-glass-sm md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
            Invite handoff
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-text-main font-display">
            Примите приглашение и сразу попадите в рабочее пространство
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Приглашение привязано к конкретному email. Сначала войдите тем же аккаунтом, затем
            подтвердите доступ и перейдите в организацию без лишних промежуточных экранов.
          </p>

          <div className="mt-6 space-y-3">
            {[
              {
                title: "1. Войдите",
                text: "Используйте тот же email, на который пришло приглашение.",
              },
              {
                title: "2. Подтвердите",
                text: "Проверьте token из письма и завершите принятие инвайта.",
              },
              {
                title: "3. Начните работу",
                text: "Откройте организацию, чтобы видеть роли, инвайты и лимиты.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/60 bg-white/70 px-4 py-4">
                <p className="text-sm font-semibold text-text-main">{item.title}</p>
                <p className="mt-2 text-xs leading-5 text-text-secondary">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/login?mode=signin"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Войти в аккаунт
            </Link>
            <Link
              href="/org"
              className="rounded-full border border-gray-200 bg-white/80 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
            >
              Открыть org
            </Link>
          </div>
        </section>

        <div className="max-w-xl">
          <InviteAcceptanceCard token={token} />
        </div>
      </div>
    </div>
  );
}
