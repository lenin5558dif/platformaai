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
    <div className="relative z-10 flex h-[100dvh] w-full overflow-hidden text-text-main font-display">
      <WorkspaceSidebar activeTool="images" user={user} />
      <main className="relative flex h-full min-w-0 flex-1 flex-col">
        <header className="pointer-events-none absolute left-0 right-0 top-0 z-30 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:px-6 md:py-4">
          <div className="pointer-events-auto mx-auto flex w-full max-w-6xl items-center justify-between gap-3 glass-panel rounded-xl px-3 py-3 shadow-lg sm:px-4">
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight text-text-primary md:text-lg">
                Изображения
              </h1>
              <p className="text-xs text-text-secondary">Генератор и галерея</p>
            </div>
            <div className="shrink-0">
              <ToolTabs active="images" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-3 pb-6 pt-[104px] sm:px-4 md:px-6 md:pt-[108px]">
          <div className="mx-auto w-full max-w-6xl pb-10">
            <ImageStudio />
          </div>
        </div>
      </main>
    </div>
  );
}
