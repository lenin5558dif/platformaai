import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import AppShell from "@/components/layout/AppShell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSettingsObject } from "@/lib/user-settings";

export const dynamic = "force-dynamic";

async function createPrompt(formData: FormData) {
  "use server";
  const session = await auth();

  if (!session?.user?.id) {
    return;
  }

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "ORG");
  const rawTags = String(formData.get("tags") ?? "");
  const tags = rawTags
    .split(/[,\n]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (title.length < 2 || content.length < 10) {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, email: true, role: true, settings: true },
  });

  const resolvedVisibility =
    visibility === "ORG" && !user?.orgId ? "PRIVATE" : visibility;
  const orgId = resolvedVisibility === "ORG" ? user?.orgId ?? null : null;

  await prisma.prompt.create({
    data: {
      title,
      content,
      orgId,
      visibility: resolvedVisibility as "PRIVATE" | "ORG" | "GLOBAL",
      tags: Array.from(new Set(tags)),
      createdById: session.user.id,
    },
  });

  revalidatePath("/prompts");
}

export default async function PromptsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Библиотека недоступна
          </h1>
          <p className="text-sm text-text-secondary">
            Пожалуйста, войдите в аккаунт.
          </p>
        </div>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, email: true, role: true, settings: true },
  });

  const orConditions: Prisma.PromptWhereInput[] = [
    { visibility: "GLOBAL" as const },
    { visibility: "PRIVATE" as const, createdById: session.user.id },
  ];

  if (user?.orgId) {
    orConditions.push({ visibility: "ORG" as const, orgId: user.orgId });
  }

  const settings = getSettingsObject(user?.settings ?? null);
  const planName =
    typeof settings.planName === "string" ? settings.planName : "Pro Plan";

  const prompts = await prisma.prompt.findMany({
    where: { OR: orConditions },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AppShell
      title="Библиотека промптов"
      subtitle="Готовые сценарии для быстрых запусков."
      user={{
        email: user?.email,
        role: user?.role,
        planName,
      }}
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-3 font-display">
            Добавить промпт
          </h2>
          <form action={createPrompt} className="space-y-3">
            <input
              name="title"
              className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
              placeholder="Название"
              required
            />
            <input
              name="tags"
              className="w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
              placeholder="Теги (через запятую)"
            />
            <textarea
              name="content"
              className="w-full min-h-[120px] rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
              placeholder="Текст промпта"
              required
            />
            <select
              name="visibility"
              className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-sm"
              defaultValue={user?.orgId ? "ORG" : "PRIVATE"}
            >
              <option value="PRIVATE">Личный</option>
              <option value="ORG">Для организации</option>
              <option value="GLOBAL">Глобальный</option>
            </select>
            <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover">
              Сохранить
            </button>
          </form>
        </div>

        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h2 className="text-lg font-semibold text-text-main mb-4 font-display">
            Список промптов
          </h2>
          <div className="space-y-3">
            {prompts.length === 0 && (
              <p className="text-xs text-text-secondary">Промптов пока нет.</p>
            )}
            {prompts.map((prompt) => (
              <div
                key={prompt.id}
                className="rounded-xl border border-gray-200 bg-white/70 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text-main">
                    {prompt.title}
                  </p>
                  <Link
                    className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                    href={`/?prompt=${encodeURIComponent(prompt.content)}`}
                  >
                    Использовать
                  </Link>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5">
                    {prompt.visibility === "GLOBAL"
                      ? "Глобальный"
                      : prompt.visibility === "ORG"
                      ? "Орг"
                      : "Личный"}
                  </span>
                  {prompt.tags.map((tag) => (
                    <span
                      key={`${prompt.id}-${tag}`}
                      className="rounded-full bg-white px-2 py-0.5 border border-gray-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-text-secondary mt-2 whitespace-pre-wrap">
                  {prompt.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
