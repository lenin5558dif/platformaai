import { redirect } from "next/navigation";
import ImageStudio from "@/components/images/ImageStudio";
import AppShell from "@/components/layout/AppShell";
import { auth } from "@/lib/auth";
import { getBillingTier, getBillingTierLabel } from "@/lib/billing-tiers";
import { prisma } from "@/lib/db";
import { getSettingsObject } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

export default async function ImagesPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?mode=register");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      role: true,
      balance: true,
      settings: true,
    },
  });

  const settings = getSettingsObject(user?.settings ?? null);
  const displayName = [
    typeof settings.profileFirstName === "string" ? settings.profileFirstName : "",
    typeof settings.profileLastName === "string" ? settings.profileLastName : "",
  ].filter(Boolean).join(" ");
  const planName = getBillingTierLabel(getBillingTier(user?.settings ?? null, user?.balance));

  return (
    <AppShell
      title="Изображения"
      subtitle="Генератор и история."
      user={{
        email: user?.email,
        role: user?.role,
        displayName,
        planName,
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-10">
        <ImageStudio />
      </div>
    </AppShell>
  );
}
