import LoginForm from "@/components/auth/LoginForm";
import TelegramLoginButton from "@/components/auth/TelegramLoginButton";
import SsoLoginButton from "@/components/auth/SsoLoginButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const error = params?.error;
  const ssoEnabled = process.env.NEXT_PUBLIC_SSO_ENABLED === "1";

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
          Вход в PlatformaAI
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          Отправим magic link на вашу почту или войдите через Telegram.
        </p>
        {error === "SSORequired" && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Для этого домена доступен только вход через SSO.
          </div>
        )}
        <LoginForm />
        {ssoEnabled && (
          <div className="mt-4">
            <SsoLoginButton />
          </div>
        )}
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs text-gray-400">или</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>
        <TelegramLoginButton />
      </div>
    </div>
  );
}
