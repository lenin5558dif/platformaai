"use client";

import ImageStudio from "@/components/images/ImageStudio";
import ToolTabs from "@/components/workspace/ToolTabs";
import WorkspaceSidebar from "@/components/workspace/WorkspaceSidebar";

type ImageWorkspaceProps = {
  user?: {
    email?: string | null;
    role?: string | null;
    planName?: string | null;
    displayName?: string | null;
  };
};

export default function ImageWorkspace({ user }: ImageWorkspaceProps) {
  return (
    <div className="relative z-10 flex h-[100dvh] w-full overflow-hidden bg-[#f0f0f5] text-text-main font-display">
      <WorkspaceSidebar activeTool="images" user={user} />
      <main className="relative flex h-full min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-white/50 bg-white/50 px-3 py-3 backdrop-blur-sm sm:px-5">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-semibold text-text-primary">
                Изображения
              </h1>
              <p className="text-xs text-text-secondary">Генератор и галерея</p>
            </div>
            <ToolTabs active="images" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          <div className="mx-auto w-full max-w-6xl pb-10">
            <ImageStudio />
          </div>
        </div>
      </main>
    </div>
  );
}
