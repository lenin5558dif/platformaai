import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const chat = await prisma.chat.findFirst({
    where: { shareToken: token },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!chat) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6 text-center">
          <h1 className="text-2xl font-semibold text-text-main mb-2 font-display">
            Ссылка недоступна
          </h1>
          <p className="text-sm text-text-secondary">
            Чат не найден или доступ закрыт.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="rounded-2xl bg-white/80 border border-white/50 shadow-glass-sm p-6">
          <h1 className="text-2xl font-semibold text-text-main font-display">
            {chat.title}
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Модель: {chat.modelId}
          </p>
        </div>
        <div className="space-y-4">
          {chat.messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === "USER" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-soft ${
                  message.role === "USER"
                    ? "bg-primary text-white"
                    : "bg-white/80 text-text-main"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
