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
      <div className="w-full max-w-md rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <LoginForm
          initialMode={mode}
          initialError={params?.error}
          capabilities={capabilities}
        />
      </div>
    </div>
  );
}
