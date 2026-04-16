import LoginForm from "@/components/auth/LoginForm";
import { getAuthCapabilities, resolveAuthMode } from "@/lib/auth-ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; mode?: string; verification?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const capabilities = getAuthCapabilities();
  const mode = resolveAuthMode(params?.mode);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10 bg-[radial-gradient(circle_at_top,rgba(77,163,255,0.08),transparent_36%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_100%)]">
      <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <LoginForm
          initialMode={mode}
          initialError={params?.error}
          initialVerification={params?.verification}
          capabilities={capabilities}
        />
      </div>
    </div>
  );
}
