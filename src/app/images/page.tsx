import { redirect } from "next/navigation";
import ImageWorkspace from "@/components/images/ImageWorkspace";
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
    <ImageWorkspace
      user={{
        email: user?.email,
        role: user?.role,
        displayName,
        planName,
      }}
    />
  );
}
