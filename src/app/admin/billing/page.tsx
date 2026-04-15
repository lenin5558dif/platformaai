export const dynamic = "force-dynamic";

export default function AdminBillingPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
        <h1 className="text-2xl font-semibold text-text-main font-display">
          Финансы и биллинг
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Управление платежами, тарифами и финансовыми отчетами.
        </p>
      </div>

      <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-10 text-center">
        <p className="text-lg font-semibold text-text-main">В разработке...</p>
      </div>
    </div>
  );
}
