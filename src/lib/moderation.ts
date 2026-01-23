const DEFAULT_BLOCKLIST = [
  "суицид",
  "самоубий",
  "террор",
  "экстремизм",
  "изнасил",
  "child sexual",
  "csem",
];

function normalizeList(value?: string) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function checkModeration(text: string) {
  if (process.env.MODERATION_ENABLED === "0") {
    return { ok: true } as const;
  }

  const rawList = normalizeList(process.env.MODERATION_BLOCKLIST);
  const blocklist = rawList.length ? rawList : DEFAULT_BLOCKLIST;
  const lower = text.toLowerCase();

  for (const keyword of blocklist) {
    if (lower.includes(keyword.toLowerCase())) {
      return { ok: false, reason: `Blocked keyword: ${keyword}` } as const;
    }
  }

  return { ok: true } as const;
}
