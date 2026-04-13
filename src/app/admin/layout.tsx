import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import AdminSidebar from "@/components/admin/AdminSidebar";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?mode=signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, email: true },
  });

  if (!user || user.role !== "ADMIN") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Недостаточно прав
          </h1>
          <p className="text-sm text-text-secondary">
            Раздел администрирования доступен только администраторам.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:flex bg-[#f3f3f8]">
      <AdminSidebar userEmail={user.email} />
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
