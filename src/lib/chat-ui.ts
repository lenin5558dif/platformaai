export type ModelPricing = {
  prompt?: string;
  completion?: string;
};

type ModelInfo = {
  id: string;
  pricing?: ModelPricing;
  contextLength?: number;
};

type ChatListItem = {
  updatedAt: string;
  pinned?: boolean;
};

type ChatGroup<T extends ChatListItem> = {
  label: string;
  items: T[];
};

export function getChatGroups<T extends ChatListItem>(chats: T[]): ChatGroup<T>[] {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: Record<string, T[]> = {
    Pinned: [],
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    Older: [],
  };

  for (const chat of chats) {
    if (chat.pinned) {
      groups.Pinned.push(chat);
      continue;
    }
    const updatedAt = new Date(chat.updatedAt);
    if (updatedAt >= startOfToday) {
      groups.Today.push(chat);
    } else if (updatedAt >= startOfYesterday) {
      groups.Yesterday.push(chat);
    } else if (updatedAt >= weekAgo) {
      groups["Previous 7 Days"].push(chat);
    } else {
      groups.Older.push(chat);
    }
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export function formatPricing(pricing?: ModelPricing) {
  if (!pricing?.prompt && !pricing?.completion) return "—";
  const formatPerMillion = (value?: string) => {
    if (!value) return "—";
    const perToken = Number(value);
    if (!Number.isFinite(perToken)) return "—";
    const perMillion = perToken * 1_000_000;
    const decimals = perMillion < 1 ? 4 : perMillion < 10 ? 3 : 2;
    return `$${perMillion.toFixed(decimals)}/1M`;
  };

  return `Prompt ${formatPerMillion(pricing.prompt)} · Completion ${formatPerMillion(
    pricing.completion
  )}`;
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateUsdCost(params: {
  promptTokens: number;
  completionTokens: number;
  pricing?: ModelPricing;
}) {
  const promptPrice = params.pricing?.prompt
    ? Number(params.pricing.prompt)
    : 0;
  const completionPrice = params.pricing?.completion
    ? Number(params.pricing.completion)
    : 0;
  if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice)) {
    return 0;
  }
  return (
    params.promptTokens * promptPrice +
    params.completionTokens * completionPrice
  );
}

export function getModelCostPerMillion(model: ModelInfo) {
  const prompt = model.pricing?.prompt ? Number(model.pricing.prompt) : NaN;
  const completion = model.pricing?.completion
    ? Number(model.pricing.completion)
    : NaN;
  const hasPrompt = Number.isFinite(prompt);
  const hasCompletion = Number.isFinite(completion);
  if (!hasPrompt && !hasCompletion) return Number.POSITIVE_INFINITY;
  const total = (hasPrompt ? prompt : 0) + (hasCompletion ? completion : 0);
  return total * 1_000_000;
}

export function getModelSpeedLabel(modelId: string) {
  const id = modelId.toLowerCase();
  if (
    id.includes("flash") ||
    id.includes("turbo") ||
    id.includes("mini") ||
    id.includes("lite") ||
    id.includes("fast")
  ) {
    return "fast";
  }
  if (id.includes("opus") || id.includes("pro") || id.includes("reason")) {
    return "precise";
  }
  return "standard";
}
