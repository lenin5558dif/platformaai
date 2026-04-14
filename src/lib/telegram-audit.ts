export function buildTelegramLinkAuditMetadata(params: {
  telegramId: string;
  source: "bot" | "web";
  maskedEmail?: string | null;
}) {
  return {
    telegram: {
      action: "link",
      telegramId: params.telegramId,
      source: params.source,
      maskedEmail: params.maskedEmail ?? undefined,
    },
  };
}

export function buildTelegramUnlinkAuditMetadata(params: {
  telegramId: string;
  source: "web";
}) {
  return {
    telegram: {
      action: "unlink",
      telegramId: params.telegramId,
      source: params.source,
    },
  };
}
