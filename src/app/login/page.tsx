import LoginForm from "@/components/auth/LoginForm";
import { getAuthCapabilities, resolveAuthMode } from "@/lib/auth-ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; mode?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const capabilities = getAuthCapabilities();
  const mode = resolveAuthMode(params?.mode);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/92 p-6 shadow-glass-sm">
        <LoginForm
          initialMode={mode}
          initialError={params?.error}
          capabilities={capabilities}
        />
      </div>
    </div>
  );
}
