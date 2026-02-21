import { Suspense } from "react";
import { redirect } from "next/navigation";
import ChatApp from "@/components/chat/ChatApp";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettingsObject } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?mode=register");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true },
  });

  const settings = getSettingsObject(user?.settings ?? null);
  const isOnboarded = settings.onboarded === true;

  if (!isOnboarded) {
    redirect("/settings?onboarding=1");
  }

  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ChatApp />
    </Suspense>
  );
}
