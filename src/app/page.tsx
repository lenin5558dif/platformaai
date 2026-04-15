import { Suspense } from "react";
import { redirect } from "next/navigation";
import ChatApp from "@/components/chat/ChatApp";
import { requirePageSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettingsObject } from "@/lib/user-settings";

export default async function Home() {
  const session = await requirePageSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true },
  });
  const settings = getSettingsObject(user?.settings ?? null);

  if (settings.onboarded !== true) {
    redirect("/settings?onboarding=1");
  }

  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ChatApp />
    </Suspense>
  );
}
