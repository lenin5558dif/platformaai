import LoginForm from "@/components/auth/LoginForm";
import {
  getAuthCapabilities,
  loadAuthEmailGuardrails,
  resolveAuthMode,
} from "@/lib/auth-ui";
import Link from "next/link";

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
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-glass-sm md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
            Единый вход
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-text-main font-display">
            Один вход для чата, регистрации и управления организацией
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Используйте email, SSO или Telegram, чтобы быстро авторизоваться и продолжить работу в
            приложении без отдельного портала.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/org"
              className="rounded-full border border-gray-200 bg-white/80 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white"
            >
              Открыть организацию
            </Link>
            <Link
              href="/"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
            >
              Перейти в чат
            </Link>
          </div>
        </section>

        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/92 p-6 shadow-glass-sm">
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
