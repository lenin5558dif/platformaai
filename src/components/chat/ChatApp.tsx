"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
// import UserMenu from "@/components/layout/UserMenu"; // Replaced with inline specific UI

type Chat = {
  id: string;
  title: string;
  modelId: string;
  source?: "WEB" | "TELEGRAM";
  tags?: string[];
  pinned?: boolean;
  isFavorite?: boolean;
  shareToken?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  tokenCount?: number;
};

type MessageRecord = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt: string;
  modelId?: string | null;
  tokenCount?: number;
};

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  hasText?: boolean;
};

type ModelPricing = {
  prompt?: string;
  completion?: string;
};

type Model = {
  id: string;
  name: string;
  pricing?: ModelPricing;
  contextLength?: number;
};

type ChatGroup = {
  label: string;
  items: Chat[];
};

const DEFAULT_MODEL = "openai/gpt-4o";

function getChatGroups(chats: Chat[]): ChatGroup[] {
  const now = new Date();
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(startOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: Record<string, Chat[]> = {
    "Pinned": [],
    "Today": [],
    "Yesterday": [],
    "Previous 7 Days": [],
    "Older": [],
  };

  for (const chat of chats) {
    if (chat.pinned) {
      groups["Pinned"].push(chat);
      continue;
    }
    const updatedAt = new Date(chat.updatedAt);
    if (updatedAt >= startOfToday) {
      groups["Today"].push(chat);
    } else if (updatedAt >= startOfYesterday) {
      groups["Yesterday"].push(chat);
    } else if (updatedAt >= weekAgo) {
      groups["Previous 7 Days"].push(chat);
    } else {
      groups["Older"].push(chat);
    }
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function formatPricing(pricing?: ModelPricing) {
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

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateUsdCost(params: {
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

function getModelCostPerMillion(model: Model) {
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

function getModelSpeedLabel(modelId: string) {
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

export default function ChatApp() {
  const searchParams = useSearchParams();
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "WEB" | "TELEGRAM">(
    "ALL"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [isDraft, setIsDraft] = useState(false);
  const [hasLoadedModelPreference, setHasLoadedModelPreference] =
    useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState<
    "all" | "cheap" | "fast" | "long"
  >("all");
  const [modelQuery, setModelQuery] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [currentUser, setCurrentUser] = useState<{
    email?: string | null;
    role?: string | null;
    planName?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const skipNextLoadRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const appliedPromptRef = useRef<string | null>(null);
  const quickSettingsRef = useRef<HTMLDivElement>(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const filteredChats = useMemo(() => {
    if (sourceFilter === "ALL") return chats;
    return chats.filter((chat) => chat.source === sourceFilter);
  }, [chats, sourceFilter]);

  const sortedChats = useMemo(() => {
    return [...filteredChats].sort((a, b) => {
      const pinnedA = a.pinned ? 1 : 0;
      const pinnedB = b.pinned ? 1 : 0;
      if (pinnedA !== pinnedB) return pinnedB - pinnedA;
      const favA = a.isFavorite ? 1 : 0;
      const favB = b.isFavorite ? 1 : 0;
      if (favA !== favB) return favB - favA;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [filteredChats]);

  const chatGroups = useMemo(() => getChatGroups(sortedChats), [sortedChats]);

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? null,
    [models, selectedModel]
  );
  const fallbackModels = useMemo(() => {
    if (!models.length) return [];

    const preferred = [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "meta-llama/llama-3.1-70b-instruct",
    ];

    const available = new Set(models.map((model) => model.id));
    const fallback = preferred.filter(
      (modelId) => modelId !== selectedModel && available.has(modelId)
    );

    if (fallback.length >= 2) return fallback.slice(0, 2);

    const extra = models
      .map((model) => model.id)
      .filter((id) => id !== selectedModel && !fallback.includes(id))
      .slice(0, 2 - fallback.length);

    return [...fallback, ...extra];
  }, [models, selectedModel]);

  const estimatedPromptTokens = useMemo(() => {
    const historyTokens = messages.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0
    );
    const inputTokens = input ? estimateTokens(input) : 0;
    return historyTokens + inputTokens;
  }, [messages, input]);

  const estimatedCompletionTokens = useMemo(() => {
    const context = selectedModelInfo?.contextLength ?? 4096;
    return Math.min(512, Math.floor(context / 8));
  }, [selectedModelInfo]);

  const estimatedUsd = useMemo(() => {
    return estimateUsdCost({
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
      pricing: selectedModelInfo?.pricing,
    });
  }, [estimatedPromptTokens, estimatedCompletionTokens, selectedModelInfo]);

  const errorHint = useMemo(() => {
    if (!error) return null;
    if (error.toLowerCase().includes("unauthorized")) {
      return "Check OpenRouter API key.";
    }
    if (error.toLowerCase().includes("openrouter")) {
      return "Try another model or try again later.";
    }
    if (error.toLowerCase().includes("balance")) {
      return "Top up balance or switch to free model.";
    }
    return "Check connection and try again.";
  }, [error]);

  const errorCta = useMemo(() => {
    if (!error) return null;
    const lower = error.toLowerCase();
    if (lower.includes("unauthorized")) {
      return { href: "/settings#api-keys", label: "Add Key" };
    }
    if (lower.includes("balance")) {
      return { href: "/billing", label: "Top Up" };
    }
    return null;
  }, [error]);

  const composerState = useMemo(() => {
    if (isUploading) return "uploading";
    if (isSending) return "sending";
    return "idle";
  }, [isUploading, isSending]);

  const modelCostThreshold = useMemo(() => {
    const costs = models
      .map(getModelCostPerMillion)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    if (!costs.length) return Number.POSITIVE_INFINITY;
    const index = Math.floor(costs.length * 0.3);
    return costs[index] ?? costs[costs.length - 1];
  }, [models]);

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    return models.filter((model) => {
      if (query) {
        const haystack = `${model.name} ${model.id}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      if (modelFilter === "all") return true;
      if (modelFilter === "long") {
        return (model.contextLength ?? 0) >= 100_000;
      }
      if (modelFilter === "fast") {
        return getModelSpeedLabel(model.id) === "fast";
      }
      if (modelFilter === "cheap") {
        return getModelCostPerMillion(model) <= modelCostThreshold;
      }
      return true;
    });
  }, [models, modelFilter, modelQuery, modelCostThreshold]);

  const loadChats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("query", searchQuery.trim());
      }
      const response = await fetch(`/api/chats?${params.toString()}`);
      if (!response.ok) return;
      const data = await response.json();
      setChats(data.data ?? []);
      if (data.data?.length && !activeChatId && !isDraft) {
        setActiveChatId(data.data[0].id);
      }
    } catch {
      // ignore
    }
  }, [activeChatId, isDraft, searchQuery]);

  const loadModels = useCallback(async () => {
    try {
      const response = await fetch("/api/models");
      if (!response.ok) return;
      const payload = await response.json();
      const list = payload?.data?.data ?? [];
      const mapped: Model[] = list.map(
        (model: {
          id: string;
          name?: string;
          pricing?: ModelPricing;
          context_length?: number;
        }) => ({
          id: model.id,
          name: model.name ?? model.id,
          pricing: model.pricing,
          contextLength: model.context_length,
        })
      );
      setModels(mapped);
      if (mapped.length && !hasLoadedModelPreference) {
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem("platformaai:model")
            : null;
        const preferred = stored && mapped.some((model) => model.id === stored)
          ? stored
          : mapped[0].id;
        setSelectedModel(preferred);
        setHasLoadedModelPreference(true);
      }
    } catch {
      // ignore
    }
  }, [hasLoadedModelPreference]);

  const loadChatDetails = useCallback(async (chatId: string) => {
    try {
      const response = await fetch(`/api/chats/${chatId}`);
      if (!response.ok) return;
      const data = await response.json();
      const items = (data?.data?.messages ?? []) as MessageRecord[];
      const mapped: ChatMessage[] = items
        .filter((message) => message.role !== "SYSTEM")
        .map((message) => ({
          id: message.id,
          role: (message.role === "USER"
            ? "user"
            : "assistant") as ChatMessage["role"],
          content: message.content,
          createdAt: message.createdAt,
          tokenCount: message.tokenCount,
        }));
      setMessages(mapped);
      setAttachments((data?.data?.attachments ?? []) as Attachment[]);
    } catch {
      // ignore
    }
  }, []);

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      const confirmed = window.confirm("Delete chat forever?");
      if (!confirmed) return;

      const response = await fetch(`/api/chats/${chatId}`, {
        method: "DELETE",
      });

      if (!response.ok) return;

      setChats((prev) => prev.filter((chat) => chat.id !== chatId));

      if (activeChatId === chatId) {
        setActiveChatId(null);
        setMessages([]);
        setAttachments([]);
        setIsDraft(false);
      }
    },
    [activeChatId]
  );

  const updateChatMeta = useCallback(
    async (chatId: string, patch: Partial<Chat>) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!response.ok) return;

      setChats((prev) =>
        prev.map((chat) => (chat.id === chatId ? { ...chat, ...patch } : chat))
      );
    },
    []
  );

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      setSelectedModel(modelId);
      setModelMenuOpen(false);
      if (activeChatId) {
        await updateChatMeta(activeChatId, { modelId });
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === activeChatId ? { ...chat, modelId } : chat
          )
        );
      }
    },
    [activeChatId, updateChatMeta]
  );

  const handleToggleFavorite = useCallback(
    async (chat: Chat) => {
      await updateChatMeta(chat.id, { isFavorite: !chat.isFavorite });
    },
    [updateChatMeta]
  );

  const handleTogglePin = useCallback(
    async (chat: Chat) => {
      await updateChatMeta(chat.id, { pinned: !chat.pinned });
    },
    [updateChatMeta]
  );

  const handleUpdateTags = useCallback(
    async (chatId: string, tags: string[]) => {
      await updateChatMeta(chatId, { tags });
    },
    [updateChatMeta]
  );

  const handleShareChat = useCallback(async (chatId: string) => {
    const response = await fetch(`/api/chats/${chatId}/share`, {
      method: "POST",
    });

    if (!response.ok) return;
    const data = await response.json();
    const url = data?.data?.url;
    if (url) {
      await navigator.clipboard.writeText(url);
      alert("Link copied.");
    }
  }, []);

  useEffect(() => {
    void loadChats();
    void loadModels();
  }, [loadChats, loadModels]);

  useEffect(() => {
    function handleStatusChange() {
      setIsOnline(navigator.onLine);
    }
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    window.addEventListener("online", handleStatusChange);
    window.addEventListener("offline", handleStatusChange);
    return () => {
      window.removeEventListener("online", handleStatusChange);
      window.removeEventListener("offline", handleStatusChange);
    };
  }, []);

  useEffect(() => {
    if (!activeChat?.modelId) return;
    setSelectedModel(activeChat.modelId);
  }, [activeChat]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    function handleClick(event: MouseEvent) {
      if (!modelMenuRef.current) return;
      if (modelMenuRef.current.contains(event.target as Node)) return;
      setModelMenuOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModelMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!quickSettingsOpen) return;
    function handleClick(event: MouseEvent) {
      if (!quickSettingsRef.current) return;
      if (quickSettingsRef.current.contains(event.target as Node)) return;
      setQuickSettingsOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setQuickSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [quickSettingsOpen]);

  useEffect(() => {
    async function loadProfile() {
      try {
        const response = await fetch("/api/me");
        if (!response.ok) return;
        const data = await response.json();
        const settings = data?.data?.settings ?? null;
        const onboarded = Boolean(settings?.onboarded);
        const firstName =
          typeof settings?.profileFirstName === "string"
            ? settings.profileFirstName
            : "";
        const lastName =
          typeof settings?.profileLastName === "string"
            ? settings.profileLastName
            : "";
        const displayName = [firstName, lastName].filter(Boolean).join(" ");
        const planName =
          typeof settings?.planName === "string" ? settings.planName : "Pro Plan";
        setShowOnboarding(!onboarded);
        setCurrentUser({
          email: data?.data?.email ?? null,
          role: data?.data?.role ?? null,
          planName,
          displayName: displayName || "User",
          image: data?.data?.image ?? null,
        });
      } catch {
        // ignore
      }
    }
    void loadProfile();
  }, []);

  useEffect(() => {
    const promptParam = searchParams.get("prompt");
    if (!promptParam) return;
    if (appliedPromptRef.current === promptParam) return;
    appliedPromptRef.current = promptParam;
    setIsDraft(true);
    setActiveChatId(null);
    setMessages([]);
    setAttachments([]);
    setError(null);
    setInput(promptParam);
  }, [searchParams]);

  useEffect(() => {
    if (isDraft) {
      return;
    }

    if (!filteredChats.length) {
      setActiveChatId(null);
      return;
    }

    if (
      activeChatId &&
      filteredChats.some((chat) => chat.id === activeChatId)
    ) {
      return;
    }

    setActiveChatId(filteredChats[0].id);
  }, [filteredChats, activeChatId, isDraft]);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      setAttachments([]);
      return;
    }

    if (skipNextLoadRef.current === activeChatId) {
      skipNextLoadRef.current = null;
      return;
    }

    void loadChatDetails(activeChatId);
  }, [activeChatId, loadChatDetails]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedModel) return;
    window.localStorage.setItem("platformaai:model", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (isSending) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isSending]);

  async function createChat(title: string) {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, modelId: selectedModel }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const chat = data.data as Chat;
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    setIsDraft(false);
    return chat.id;
  }

  async function ensureChatId(title = "New Chat") {
    if (activeChatId) return activeChatId;
    const chatId = await createChat(title);
    return chatId;
  }

  async function persistUserMessage(chatId: string, content: string) {
    const tokenCount = estimateTokens(content);
    const cost = estimateUsdCost({
      promptTokens: tokenCount,
      completionTokens: 0,
      pricing: selectedModelInfo?.pricing,
    });

    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        role: "USER",
        content,
        tokenCount,
        cost,
      }),
    });
  }

  async function handleUpload(file: File) {
    const chatId = await ensureChatId(
      file.name ? file.name.slice(0, 40) : "New Chat"
    );
    if (!chatId) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("chatId", chatId);
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data?.error ?? "Upload failed.");
        return;
      }
      const data = await response.json();
      if (data?.data) {
        setAttachments((prev) => [...prev, data.data as Attachment]);
      }
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDescribeAttachment(attachment: Attachment) {
    if (!activeChatId) return;
    if (!attachment.mimeType.startsWith("image/")) return;
    setIsSending(true);
    try {
      const response = await fetch("/api/ai/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId: attachment.id, chatId: activeChatId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data?.error ?? "Description failed.");
        return;
      }
      await loadChatDetails(activeChatId);
    } finally {
      setIsSending(false);
    }
  }

  async function runAssistant(chatId: string, messageList: ChatMessage[]) {
    const assistantIndex = messageList.length;
    setMessages([...messageList, { role: "assistant", content: "" }]);
    setIsSending(true);

    if (!activeChatId) {
      skipNextLoadRef.current = chatId;
    }

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages: messageList.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          stream: true,
          chatId,
          contextLength: selectedModelInfo?.contextLength,
          fallbackModels,
          useWebSearch,
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        setError(data?.error ?? "Model request error.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.replace(/^data:\s*/, "");
          if (!payload || payload === "[DONE]") continue;

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              setMessages((prev) => {
                const updated = [...prev];
                const current = updated[assistantIndex];
                if (current) {
                  updated[assistantIndex] = {
                    ...current,
                    content: current.content + delta,
                  };
                }
                return updated;
              });
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    } finally {
      setIsSending(false);
      await loadChats();
      if (activeChatId === chatId) {
        await loadChatDetails(chatId);
      }
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    setError(null);
    setInput("");

    const chatId = await ensureChatId(text.slice(0, 40) || "New Chat");
    if (!chatId) {
      setError("Failed to create chat.");
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    await persistUserMessage(chatId, text);
    await runAssistant(chatId, nextMessages);
  }

  async function sendQuickPrompt(text: string) {
    if (!text.trim() || isSending) return;
    setError(null);
    const chatId = await ensureChatId(text.slice(0, 40) || "New Chat");
    if (!chatId) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    await persistUserMessage(chatId, text);
    await runAssistant(chatId, nextMessages);
  }

  async function handleContinue() {
    await sendQuickPrompt("Continue");
  }

  async function handleRegenerate() {
    if (isSending || !messages.length) return;
    const lastUserIndex = [...messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find((item) => item.message.role === "user")?.index;

    if (lastUserIndex === undefined) return;
    const chatId = activeChatId ?? (await ensureChatId("New Chat"));
    if (!chatId) return;

    const lastUserMessage = messages[lastUserIndex];
    if (lastUserMessage?.id) {
      await fetch(`/api/messages/${lastUserMessage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: lastUserMessage.content,
          rollback: true,
        }),
      });
    }

    const trimmedMessages = messages.slice(0, lastUserIndex + 1);
    setMessages(trimmedMessages);
    await runAssistant(chatId, trimmedMessages);
  }

  function startEditMessage(message: ChatMessage) {
    if (!message.id) return;
    setEditingMessageId(message.id);
    setEditingText(message.content);
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setEditingText("");
  }

  async function saveEditMessage() {
    if (!editingMessageId || !editingText.trim()) return;
    const index = messages.findIndex((message) => message.id === editingMessageId);
    if (index === -1) return;
    const chatId = activeChatId ?? (await ensureChatId("New Chat"));
    if (!chatId) return;

    await fetch(`/api/messages/${editingMessageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editingText.trim(), rollback: true }),
    });

    const updatedMessages = messages
      .slice(0, index + 1)
      .map((message) =>
        message.id === editingMessageId
          ? { ...message, content: editingText.trim() }
          : message
      );

    setMessages(updatedMessages);
    cancelEditMessage();
    await runAssistant(chatId, updatedMessages);
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
  }

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  return (
    <div className="relative z-10 flex h-screen w-full text-text-main overflow-hidden font-display">
      {isSidebarOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          aria-label="Close menu"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col glass-panel border-r-0 border-r-black/5 h-full transition-all duration-300 transform md:static md:z-20 md:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        <div className="p-6 pb-2">
          <div className="flex flex-col gap-1 mb-8">
            <h1 className="text-text-primary text-xl font-bold tracking-tight">
              Platforma<span className="text-primary">AI</span>
            </h1>
            <p className="text-text-secondary text-xs font-normal">Unified LLM Aggregator</p>
          </div>
          <button
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white p-3 rounded-lg transition-colors shadow-[0_0_15px_rgba(212,122,106,0.2)] group mb-6"
            onClick={() => {
              closeSidebar();
              setIsDraft(true);
              setActiveChatId(null);
              setMessages([]);
              setAttachments([]);
              setError(null);
            }}
          >
            <span className="material-symbols-outlined text-[20px] group-hover:scale-110 transition-transform">
              add
            </span>
            <span className="text-sm font-bold">New Chat</span>
          </button>

          <div className="text-xs font-medium text-text-secondary/70 uppercase tracking-wider mb-3 px-2">Recent Sessions</div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2 scrollbar-hide">
          {chatGroups.map((group) => (
            <div key={group.label}>
              {group.items.map((chat) => (
                <div
                  key={chat.id}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors group ${chat.id === activeChatId
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-black/5"
                    }`}
                  onClick={() => {
                    closeSidebar();
                    setIsDraft(false);
                    setActiveChatId(chat.id);
                  }}
                >
                  <span className={`material-symbols-outlined text-[20px] ${chat.id === activeChatId ? "text-primary" : "text-text-secondary group-hover:text-primary"
                    }`}>
                    {chat.source === "TELEGRAM" ? "send" : "chat_bubble"}
                  </span>
                  <div className="flex flex-col overflow-hidden">
                    <p className={`text-sm font-medium truncate ${chat.id === activeChatId ? "text-text-primary" : "text-text-primary group-hover:text-text-primary"
                      }`}>
                      {chat.title}
                    </p>
                    <p className="text-text-secondary text-[10px] truncate">
                      {new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {!filteredChats.length && (
            <div className="px-3 text-xs text-text-secondary">No recent sessions.</div>
          )}
        </div>

        <div className="p-4 mt-auto border-t border-black/10 bg-black/5 bg-background-light/50">
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-text-secondary">Tokens (This Month)</span>
              <span className="text-primary font-bold">84%</span>
            </div>
            <div className="w-full bg-black/10 rounded-full h-1.5">
              <div className="bg-primary h-1.5 rounded-full shadow-[0_0_10px_rgba(212,122,106,0.2)]" style={{ width: "84%" }}></div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <div className="size-8 rounded-full bg-gray-300 ring-2 ring-black/10 flex items-center justify-center text-text-secondary font-bold" style={{ backgroundImage: `url(${currentUser?.image})`, backgroundSize: 'cover' }}>
                {!currentUser?.image && (currentUser?.displayName?.[0] || "U")}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-text-primary">{currentUser?.displayName || "User"}</span>
                <span className="text-xs text-text-secondary">{currentUser?.planName || "Pro Plan"}</span>
              </div>
              <Link href="/settings" className="ml-auto text-text-secondary hover:text-text-primary">
                <span className="material-symbols-outlined text-[20px]">settings</span>
              </Link>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative h-full">
        {/* Floating Header */}
        <header className="absolute top-0 left-0 right-0 z-30 px-6 py-4 pointer-events-none">
          <div className="glass-panel rounded-xl px-4 py-3 flex items-center justify-between shadow-lg pointer-events-auto">
            <div className="flex items-center gap-4">
              <button
                className="md:hidden text-text-secondary hover:text-text-primary"
                onClick={() => setIsSidebarOpen(true)}
              >
                <span className="material-symbols-outlined">menu</span>
              </button>
              <h2 className="text-text-primary text-base md:text-lg font-bold leading-tight flex items-center gap-2">
                {activeChat ? activeChat.title : "New Session"}
                {(!activeChat || activeChat) && (
                  <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] bg-primary/10 text-primary border border-primary/20">
                    Active
                  </span>
                )}
              </h2>
            </div>

            <div className="flex items-center gap-2" ref={modelMenuRef}>
              <div className="hidden md:flex h-8 items-center justify-center gap-x-2 rounded-lg bg-primary/10 border border-primary/20 pl-2 pr-3 cursor-pointer hover:bg-primary/20 transition-colors"
                onClick={() => setModelMenuOpen(!modelMenuOpen)}
              >
                <span className="material-symbols-outlined text-primary text-[18px]">smart_toy</span>
                <p className="text-primary text-xs font-bold">{selectedModelInfo?.name ?? "GPT-4"}</p>
              </div>

              <div className="hidden sm:flex h-8 items-center justify-center gap-x-2 rounded-lg bg-black/5 hover:bg-black/10 border border-black/5 pl-2 pr-3 cursor-pointer transition-colors">
                <span className="material-symbols-outlined text-text-secondary text-[18px]">bolt</span>
                <p className="text-text-secondary text-xs font-medium">Claude 3 Opus</p>
              </div>

              {modelMenuOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-white/60 bg-white/90 p-2 shadow-glass-lg backdrop-blur-md">
                  <div className="max-h-60 overflow-y-auto">
                    {filteredModels.map(model => (
                      <button
                        key={model.id}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${selectedModel === model.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-black/5 text-text-main'}`}
                        onClick={() => void handleSelectModel(model.id)}
                      >
                        {model.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="h-8 w-[1px] bg-black/10 mx-1"></div>

              <button
                className="size-8 flex items-center justify-center rounded-lg hover:bg-black/10 text-text-secondary hover:text-text-primary transition-colors"
                onClick={() => activeChatId && handleShareChat(activeChatId)}
              >
                <span className="material-symbols-outlined text-[20px]">share</span>
              </button>
              <div className="relative" ref={quickSettingsRef}>
                <button
                  className="size-8 flex items-center justify-center rounded-lg hover:bg-black/10 text-text-secondary hover:text-text-primary transition-colors"
                  onClick={() => setQuickSettingsOpen((prev) => !prev)}
                  aria-expanded={quickSettingsOpen}
                  aria-haspopup="true"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[20px]">tune</span>
                </button>

                {quickSettingsOpen && (
                  <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-white/60 bg-white/95 p-3 shadow-glass-lg backdrop-blur-md space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text-primary">Web search</p>
                        <p className="text-xs text-text-secondary">Добавлять результаты в подсказку</p>
                      </div>
                      <button
                        className={`material-symbols-outlined text-[26px] ${useWebSearch ? "text-primary" : "text-text-secondary"}`}
                        onClick={() => setUseWebSearch((prev) => !prev)}
                        aria-pressed={useWebSearch}
                        type="button"
                      >
                        {useWebSearch ? "toggle_on" : "toggle_off"}
                      </button>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-wide text-text-secondary/70 mb-2">
                        Источники чатов
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(["ALL", "WEB", "TELEGRAM"] as const).map((option) => (
                          <button
                            key={option}
                            className={`w-full px-3 py-2 text-xs rounded-lg border transition-colors ${sourceFilter === option
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "bg-black/5 text-text-secondary border-black/5 hover:text-text-primary"
                              }`}
                            onClick={() => setSourceFilter(option)}
                            type="button"
                          >
                            {option === "ALL" ? "Все" : option === "WEB" ? "Web" : "Telegram"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-black/10 bg-black/5 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary">Профиль и лимиты</p>
                        <p className="text-xs text-text-secondary">Биллинг, ключи, организация</p>
                      </div>
                      <Link href="/settings" className="text-primary text-sm font-semibold hover:text-primary-hover">
                        Открыть
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto pt-24 pb-40 px-6 md:px-0">
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="size-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg ring-1 ring-black/10 mb-6">
                  <span className="material-symbols-outlined text-white text-[32px]">smart_toy</span>
                </div>
                <h1 className="text-2xl font-bold text-text-main font-display mb-2">Hello! I&apos;m ready to assist.</h1>
                <p className="text-text-secondary text-sm mb-8">Choose a prompt or type your own.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl px-4">
                  {[
                    { icon: "lightbulb", color: "text-orange-500", title: "Brainstorm Ideas", subtitle: "Name a coffee brand", prompt: "Придумай 10 названий для нового бренда кофе." },
                    { icon: "code", color: "text-blue-500", title: "Write Code", subtitle: "Python sort function", prompt: "Напиши функцию Python для сортировки списка." },
                    { icon: "edit_note", color: "text-green-500", title: "Edit", subtitle: "Check grammar", prompt: "Проверь грамматику в этом тексте." },
                    { icon: "translate", color: "text-purple-500", title: "Translate", subtitle: "To Spanish", prompt: "Переведи это на испанский." }
                  ].map((item, i) => (
                    <button
                      key={i}
                      className="group flex items-start gap-3 p-4 rounded-xl prompt-card-glass text-left"
                      onClick={() => void sendQuickPrompt(item.prompt)}
                    >
                      <span className={`material-symbols-outlined ${item.color} text-[24px]`}>{item.icon}</span>
                      <div>
                        <p className="font-bold text-text-main text-sm group-hover:text-primary transition-colors">{item.title}</p>
                        <p className="text-[11px] text-text-secondary">{item.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((message, index) => {
                  const isAI = message.role === "assistant";
                  const tokenCount =
                    typeof message.tokenCount === "number"
                      ? message.tokenCount
                      : estimateTokens(message.content);
                return (
                  <div key={message.id || index} className={`flex items-start gap-4 ${isAI ? 'pr-4' : 'pl-4 justify-end'} group`}>
                    {isAI && (
                      <div className="size-10 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg ring-1 ring-black/10">
                        <span className="material-symbols-outlined text-white text-[20px]">smart_toy</span>
                      </div>
                    )}

                    <div className={`flex flex-col gap-2 max-w-[85%] md:max-w-[75%] ${!isAI && 'items-end'}`}>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-bold text-text-primary">{isAI ? "PlatformaAI" : "You"}</span>
                        <span className="text-xs text-text-secondary" suppressHydrationWarning>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      <div className={`p-5 text-sm md:text-base leading-relaxed text-text-primary shadow-sm
                                    ${isAI
                          ? 'glass-message-ai rounded-3xl rounded-tl-sm'
                          : 'glass-panel bg-white/95 text-text-primary border border-primary/30 rounded-3xl rounded-tr-sm shadow-[0_4px_20px_rgba(212,122,106,0.15)] overflow-hidden relative'
                        }
                                `}>
                        {!isAI && <div className="absolute inset-0 bg-gradient-to-br from-white/70 via-white/30 to-transparent pointer-events-none"></div>}

                        <div className="relative z-10">
                          {isAI ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeHighlight]}
                              className="chat-markdown"
                            >
                              {message.content || ""}
                            </ReactMarkdown>
                          ) : (
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          )}
                          {isAI && isSending && index === messages.length - 1 && !message.content && (
                            <span className="animate-pulse">Thinking...</span>
                          )}
                        </div>

                        {isAI && (
                          <div className="mt-4 pt-4 border-t border-black/5 flex flex-wrap gap-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/5 border border-black/10">
                              <span className="material-symbols-outlined text-primary text-[14px]">token</span>
                              <span className="text-xs text-text-secondary">
                                Tokens: <strong>{tokenCount.toLocaleString()}</strong>
                              </span>
                            </div>
                            <button className="ml-auto flex items-center gap-1 text-xs text-primary hover:text-text-primary transition-colors" onClick={() => handleCopy(message.content)}>
                              <span className="material-symbols-outlined text-[16px]">content_copy</span>
                              Copy
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {!isAI && (
                      <div className="size-10 shrink-0 rounded-full bg-gray-200 flex items-center justify-center shadow-lg text-gray-500" style={{ backgroundImage: `url(${currentUser?.image})`, backgroundSize: 'cover' }}>
                        {!currentUser?.image && <span className="material-symbols-outlined text-[20px]">person</span>}
                      </div>
                    )}
                  </div>
                );
              })}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="sticky bottom-6 left-0 right-0 px-4 flex justify-center z-40">
          <div className="w-full max-w-[720px] glass-input rounded-3xl p-2 flex flex-col gap-2 transition-all focus-within:ring-0 focus-within:shadow-[0_0_0_6px_rgba(212,122,106,0.14)]">
            {attachments.length > 0 && (
              <div className="flex px-3 gap-2 overflow-x-auto py-1">
                {attachments.map(att => (
                  <div key={att.id} className="text-xs bg-white/50 px-2 py-1 rounded-md flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">attach_file</span>
                    <span className="truncate max-w-[100px]">{att.filename}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 p-2">
              <button
                className="p-2 text-text-secondary hover:text-primary transition-colors rounded-full hover:bg-black/5 shrink-0"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="material-symbols-outlined text-[24px]">add_circle</span>
              </button>
              <input
                type="file"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleUpload(e.target.files[0]);
                }}
              />

              <textarea
                className="w-full bg-transparent border-none text-text-primary placeholder-text-secondary focus:ring-0 focus:outline-none focus-visible:outline-none resize-none max-h-32 py-2.5 text-sm md:text-base leading-normal scrollbar-hide"
                placeholder="Ask anything or paste text..."
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              ></textarea>

              <button
                className="p-2 bg-primary text-white hover:bg-primary/90 transition-colors rounded-full shrink-0 shadow-[0_0_15px_rgba(212,122,106,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleSend()}
                disabled={!input.trim() || isSending}
              >
                <span className="material-symbols-outlined text-[20px] translate-x-0.5">arrow_upward</span>
              </button>
            </div>
            <div className="flex items-center justify-between px-3 pb-1">
              <div className="flex items-center gap-1">
                <button className="p-1.5 rounded-md hover:bg-black/5 text-text-secondary hover:text-text-primary transition-colors">
                  <span className="material-symbols-outlined text-[18px]">mic</span>
                </button>
                <button className="p-1.5 rounded-md hover:bg-black/5 text-text-secondary hover:text-text-primary transition-colors">
                  <span className="material-symbols-outlined text-[18px]">image</span>
                </button>
              </div>
              <div className="text-[10px] text-text-secondary/70 font-mono hidden sm:block">
                Press Enter to send, Shift + Enter for new line
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
