import Link from "next/link";
import LoginForm from "@/components/auth/LoginForm";
import {
  getAuthCapabilities,
  loadAuthEmailGuardrails,
  resolveAuthMode,
} from "@/lib/auth-ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; mode?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const capabilities = getAuthCapabilities();
  const emailGuardrails = loadAuthEmailGuardrails();
  const mode = resolveAuthMode(params?.mode);

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-glass-sm md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
            Access gateway
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-text-main font-display">
            Один вход для чата, регистрации и управления организацией
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            Войдите через email, SSO или Telegram, а затем откройте рабочее пространство
            организации, чтобы приглашать людей, настраивать роли и управлять лимитами без
            отдельного админ-портала.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "1. Вход",
                text: "Используйте доступный метод и попадите в единый профиль.",
              },
              {
                title: "2. Организация",
                text: "Откройте /org, чтобы управлять членами команды и правами.",
              },
              {
                title: "3. Контроль",
                text: "Invites, cost centers и governance собраны в одном месте.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/60 bg-white/70 px-4 py-4"
              >
                <p className="text-sm font-semibold text-text-main">{item.title}</p>
                <p className="mt-2 text-xs leading-5 text-text-secondary">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/org"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Открыть организацию
            </Link>
            <Link
              href="/"
              className="rounded-full border border-gray-200 bg-white/80 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
            >
              Перейти в чат
            </Link>
          </div>
        </section>

        <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-glass-sm md:p-8">
          <LoginForm
            initialMode={mode}
            initialError={params?.error}
            capabilities={capabilities}
            emailGuardrails={emailGuardrails}
          />
        </div>
      </div>
    </div>
  );
}
