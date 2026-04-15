import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PlanCheckoutButton from "@/components/billing/PlanCheckoutButton";
import { BILLING_PLANS } from "@/lib/plans";

export default function PricingPage() {
  const personalPlans = BILLING_PLANS;

  return (
    <AppShell title="Тарифы" subtitle="Выберите оптимальный план под ваши задачи.">
      <div className="flex w-full flex-col items-center">
        <section className="relative flex w-full justify-center overflow-hidden bg-white/70 px-4 pb-8 pt-10 md:px-10 lg:pb-16 lg:pt-16 rounded-2xl border border-white/50 shadow-glass-sm">
          <div className="absolute left-0 top-0 h-full w-full bg-[radial-gradient(circle_at_top_center,_var(--tw-gradient-stops))] from-indigo-50/50 via-white to-white" />
          <div className="z-10 flex w-full max-w-[960px] flex-col items-center gap-6 text-center">
            <h1 className="font-display text-4xl font-black leading-tight tracking-[-0.033em] text-slate-900 md:text-5xl lg:text-6xl">
              Раскройте потенциал всех{" "}
              <span className="bg-gradient-to-r from-primary to-violet-500 bg-clip-text text-transparent">
                LLM
              </span>
            </h1>
            <p className="max-w-[600px] text-lg font-normal leading-relaxed text-slate-500 md:text-xl">
              Единый интерфейс для GPT-4, Claude 3, Llama 3 и других моделей.
              Выберите идеальный план для ваших задач.
            </p>
            <div className="mt-6 flex items-center justify-center gap-4">
              <span className="text-sm font-medium text-slate-900">
                Ежемесячно
              </span>
              <label className="relative inline-flex cursor-pointer items-center">
                <input className="peer sr-only" type="checkbox" />
                <div className="h-6 w-11 rounded-full bg-slate-200 after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-white" />
              </label>
              <span className="text-sm font-medium text-slate-900">
                Ежегодно{" "}
                <span className="ml-1 rounded bg-indigo-50 px-2 py-0.5 text-xs font-bold text-primary">
                  -20%
                </span>
              </span>
            </div>
          </div>
        </section>

        <section className="sticky top-4 z-20 mt-6 flex w-full justify-center bg-white/90 px-4 py-2 backdrop-blur-sm md:px-10 rounded-xl border border-white/50">
          <div className="w-full max-w-[320px]">
            <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button
                className="flex-1 rounded-lg bg-white py-2 text-sm font-bold leading-normal text-slate-900 shadow-sm ring-1 ring-black/5"
                type="button"
              >
                Персональный (B2C)
              </button>
              <button
                className="flex-1 rounded-lg py-2 text-sm font-bold leading-normal text-slate-500 transition-all hover:text-slate-900"
                type="button"
              >
                Бизнес (B2B)
              </button>
            </div>
          </div>
        </section>

        <section className="flex w-full justify-center px-4 py-8 md:px-10 lg:py-12">
          <div className="grid w-full max-w-[1200px] grid-cols-1 items-start gap-8 md:grid-cols-2 lg:grid-cols-3">
            {personalPlans.map((plan) => {
              const isFeatured = plan.id === "creator";
              const wrapperClass = isFeatured
                ? "group relative z-10 flex flex-col gap-5 rounded-2xl border-2 border-primary bg-white p-8 shadow-2xl shadow-primary/15 md:-translate-y-4"
                : "group flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-8 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5";
              const priceClass = isFeatured
                ? "text-5xl font-black tracking-tight"
                : "text-4xl font-black tracking-tight";
              const buttonClass = isFeatured
                ? "mt-2 h-12 w-full rounded-lg bg-primary text-sm font-bold tracking-wide text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90"
                : "mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white text-sm font-bold tracking-wide text-slate-900 shadow-sm transition-all hover:border-primary hover:text-primary";
              const buttonLabel =
                plan.id === "starter" ? "Попробовать бесплатно" : `Выбрать «${plan.name}»`;

              return (
                <div key={plan.id} className={wrapperClass}>
                  {plan.badge && isFeatured && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white shadow-md">
                      {plan.badge}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold leading-tight text-slate-900">
                        {plan.name}
                      </h3>
                      {plan.badge && !isFeatured && (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-700">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-baseline gap-1 text-slate-900">
                      <span className={priceClass}>${plan.monthlyPriceUsd}</span>
                      <span className="text-sm font-medium text-slate-500">/мес</span>
                    </div>
                    <p className="mt-1 min-h-[40px] text-sm leading-relaxed text-slate-500">
                      {plan.description}
                    </p>
                  </div>
                  {plan.id === "starter" ? (
                    <Link className={buttonClass} href="/login?mode=register">
                      {buttonLabel}
                    </Link>
                  ) : (
                    <PlanCheckoutButton
                      className={buttonClass}
                      label={buttonLabel}
                      planId={plan.id}
                    />
                  )}
                  <div className="my-1 h-px w-full bg-slate-100" />
                  <div className="flex flex-col gap-4">
                    {plan.features.map((item) => (
                      <div
                        key={item}
                        className={`flex items-start gap-3 text-sm ${
                          isFeatured ? "text-slate-700" : "text-slate-600"
                        }`}
                      >
                        <span className="material-symbols-outlined shrink-0 text-[20px] text-primary">
                          {isFeatured ? "check_circle" : "check"}
                        </span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex w-full justify-center px-4 py-8 md:px-10">
          <div className="w-full max-w-[960px] rounded-2xl border border-slate-200 bg-slate-50 p-8">
            <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
              <div className="flex flex-col gap-2">
                <h3 className="text-2xl font-bold text-slate-900">
                  Сравнение возможностей
                </h3>
                <p className="max-w-md text-sm text-slate-500">
                  Сверяйте включенные кредиты по подписке, доступные модели и
                  возможность докупать дополнительный баланс.
                </p>
              </div>
              <button
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 font-bold text-primary shadow-sm transition-colors hover:text-primary/80 hover:shadow-md"
                type="button"
              >
                Показать полную таблицу
                <span className="material-symbols-outlined">expand_more</span>
              </button>
            </div>
          </div>
        </section>

        <section className="w-full border-t border-slate-100 bg-white px-4 py-16 md:px-10">
          <div className="mx-auto max-w-[1200px] text-center">
            <p className="mb-10 text-sm font-bold uppercase tracking-widest text-slate-400">
              Поддерживаемые модели
            </p>
            <div className="flex flex-wrap items-center justify-center gap-8 opacity-70 transition-all duration-500 hover:opacity-100 md:gap-16">
              {[
                { icon: "smart_toy", label: "OpenAI" },
                { icon: "psychology", label: "Anthropic" },
                { icon: "rocket_launch", label: "Mistral AI" },
                { icon: "code", label: "Meta Llama" },
                { icon: "google", label: "Google Gemini" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-3xl text-slate-700">
                    {item.icon}
                  </span>
                  <span className="text-xl font-bold text-slate-700">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="faq"
          className="flex w-full justify-center bg-slate-50 px-4 py-16 md:px-10"
        >
          <div className="flex w-full max-w-[800px] flex-col gap-10">
            <div className="text-center">
              <h2 className="mb-3 text-3xl font-bold text-slate-900">
                Часто задаваемые вопросы
              </h2>
              <p className="text-slate-500">
                Ответы на популярные вопросы о тарифах и лимитах.
              </p>
            </div>
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              {[
                {
                  question: "Как устроены лимиты в подписке?",
                  answer:
                    "Подписка дает включенный лимит кредитов на период. Когда он заканчивается, вы можете докупить дополнительные кредиты и продолжить работу без смены тарифа.",
                },
                {
                  question: "Могу ли я сменить тариф в любой момент?",
                  answer:
                    "Да, вы можете повысить или понизить тариф в любое время. При повышении тарифа изменения вступают в силу немедленно с перерасчетом стоимости.",
                },
                {
                  question: "Что происходит, если включенные кредиты закончились?",
                  answer:
                    "Лимит по подписке не обнуляет ваш аккаунт. После исчерпания включенных кредитов можно докупить дополнительный баланс и продолжать пользоваться тем же тарифом.",
                },
                {
                  question: "Что такое доступ к API в плане «Профи»?",
                  answer:
                    "Вы получаете унифицированный API ключ, который позволяет интегрировать возможности всех поддерживаемых нами LLM (GPT-4, Claude и др.) в ваши собственные приложения, используя единый формат запросов.",
                },
                {
                  question: "Есть ли пробный период для платных тарифов?",
                  answer:
                    "Мы не предоставляем триал для тарифа «Креатор», но вы можете начать с бесплатного плана «Старт», чтобы оценить интерфейс и базовые возможности платформы перед покупкой.",
                },
              ].map((item) => (
                <div key={item.question} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                  <details className="group">
                    <summary className="flex cursor-pointer items-center justify-between rounded p-2 font-medium text-slate-900 transition-colors hover:bg-slate-50">
                      <span>{item.question}</span>
                      <span className="transition group-open:rotate-180">
                        <span className="material-symbols-outlined text-slate-400">
                          expand_more
                        </span>
                      </span>
                    </summary>
                    <p className="mt-2 px-2 text-sm leading-relaxed text-slate-600">
                      {item.answer}
                    </p>
                  </details>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex w-full justify-center bg-white px-4 py-16 md:px-10">
          <div className="relative w-full max-w-[960px] overflow-hidden rounded-3xl bg-primary p-8 text-center shadow-2xl shadow-primary/20 md:p-12">
            <div className="absolute left-0 top-0 h-full w-full bg-[url('https://placeholder.pics/svg/100')] opacity-10 mix-blend-overlay" />
            <div className="absolute right-0 top-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
            <div className="relative z-10 flex flex-col items-center gap-6">
              <h2 className="text-3xl font-bold text-white md:text-4xl">
                Готовы начать?
              </h2>
              <p className="max-w-xl text-lg text-indigo-100">
                Присоединяйтесь к тысячам разработчиков и креаторов,
                использующих OmniLLM для своих задач уже сегодня.
              </p>
              <div className="mt-2 flex gap-4">
                <Link
                  className="flex h-12 min-w-[140px] items-center justify-center rounded-lg bg-white px-6 text-base font-bold text-primary shadow-lg transition-colors hover:bg-indigo-50"
                  href="/login"
                >
                  Начать бесплатно
                </Link>
                <Link
                  className="flex h-12 min-w-[140px] items-center justify-center rounded-lg border border-white/30 px-6 text-base font-bold text-white transition-colors hover:bg-white/10"
                  href="/org"
                >
                  Связаться с нами
                </Link>
              </div>
            </div>
          </div>
        </section>
      <footer className="w-full border-t border-slate-200 bg-slate-50 px-4 py-12 md:px-10">
        <div className="mx-auto flex max-w-[1280px] flex-col justify-between gap-10 md:flex-row">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-slate-900">
              <span className="material-symbols-outlined text-primary">hub</span>
              <span className="text-lg font-bold">OmniLLM</span>
            </div>
            <p className="max-w-[250px] text-sm text-slate-500">
              Ваш единый хаб для доступа к передовым языковым моделям.
            </p>
            <div className="mt-2 flex gap-4">
              <a
                className="text-slate-400 transition-colors hover:text-primary"
                href="#"
              >
                <span className="material-symbols-outlined">public</span>
              </a>
              <a
                className="text-slate-400 transition-colors hover:text-primary"
                href="#"
              >
                <span className="material-symbols-outlined">mail</span>
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                Продукт
              </h4>
              <Link
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="/models"
              >
                Модели
              </Link>
              <Link
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="/pricing"
              >
                Тарифы
              </Link>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                История изменений
              </a>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                Документация
              </a>
            </div>
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                Компания
              </h4>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                О нас
              </a>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                Блог
              </a>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                Карьера
              </a>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                Контакты
              </a>
            </div>
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                Юридическое
              </h4>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                Приватность
              </a>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                Условия
              </a>
              <a
                className="text-sm text-slate-500 transition-colors hover:text-primary"
                href="#"
              >
                Файлы cookie
              </a>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-12 flex max-w-[1280px] flex-col items-center justify-between gap-4 border-t border-slate-200 pt-6 md:flex-row">
          <p className="text-xs text-slate-400">
            © 2024 OmniLLM Inc. Все права защищены.
          </p>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs font-medium text-slate-500">
              Все системы в норме
            </span>
          </div>
        </div>
      </footer>
    </div>
    </AppShell>
  );
}
