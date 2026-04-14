import { Suspense } from "react";
import ChatApp from "@/components/chat/ChatApp";
import { requirePageSession } from "@/lib/auth";

export default async function Home() {
  await requirePageSession();

  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ChatApp />
    </Suspense>
  );
}
