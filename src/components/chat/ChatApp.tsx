"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  estimateTokens,
  estimateUsdCost,
  formatPricing,
  getChatGroups,
  getModelCostPerMillion,
  getModelSpeedLabel,
  type ModelPricing,
} from "@/lib/chat-ui";
import { parseGeneratedImageMessage } from "@/lib/chat-generated-image";
import { detectImageGenerationIntent } from "@/lib/image-intent";
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

const IMAGE_GENERATION_LOADING_CONTENT = "__PLATFORMAAI_IMAGE_LOADING__";

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

type Model = {
  id: string;
  name: string;
  pricing?: ModelPricing;
  contextLength?: number;
};

const DEFAULT_MODEL = "openai/gpt-4o";
const COMPOSER_MAX_HEIGHT = 128;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 120;

function isNearBottom(element: HTMLElement, threshold = AUTO_SCROLL_BOTTOM_THRESHOLD_PX) {
  const distanceToBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceToBottom <= threshold;
}

function resizeComposer(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  const nextHeight = Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = element.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
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
  const [sourceFilter] = useState<"ALL" | "WEB" | "TELEGRAM">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [useWebSearch] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [isDraft, setIsDraft] = useState(false);
  const [hasLoadedModelPreference, setHasLoadedModelPreference] =
    useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState<
    "all" | "cheap" | "fast" | "long"
  >("all");
  const [modelQuery, setModelQuery] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [streamingChatId, setStreamingChatId] = useState<string | null>(null);
  const [apiKeyState, setApiKeyState] = useState<"ok" | "missing" | "invalid">(
    "ok"
  );
  const [currentUser, setCurrentUser] = useState<{
    email?: string | null;
    role?: string | null;
    planName?: string | null;
    displayName?: string | null;
    image?: string | null;
    emailVerifiedByProvider?: boolean | null;
  } | null>(null);
  const [headerOffset, setHeaderOffset] = useState(0);
  const [composerOffset, setComposerOffset] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const skipNextLoadRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const appliedPromptRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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
    const lower = error.toLowerCase();
    if (
      lower === "unauthorized" ||
      lower.includes("auth_unauthorized") ||
      lower.includes("сессия истекла")
    ) {
      return "Войдите в аккаунт снова.";
    }
    if (
      lower.includes("openrouter") ||
      lower.includes("api key") ||
      lower.includes("неверный ключ")
    ) {
      return "Доступ к моделям временно недоступен. Обратитесь к администратору.";
    }
    if (lower.includes("openrouter")) {
      return "Попробуйте другую модель или повторите позже.";
    }
    if (lower.includes("balance")) {
      return "Пополните баланс или выберите бесплатную модель.";
    }
    return "Проверьте подключение и попробуйте снова.";
  }, [error]);

  const errorCta = useMemo(() => {
    if (!error) return null;
    const lower = error.toLowerCase();
    if (
      lower === "unauthorized" ||
      lower.includes("auth_unauthorized") ||
      lower.includes("сессия истекла")
    ) {
      return { href: "/login", label: "Войти" };
    }
    if (
      lower.includes("openrouter") ||
      lower.includes("api key") ||
      lower.includes("неверный ключ")
    ) {
      return null;
    }
    if (lower.includes("balance")) {
      return { href: "/settings", label: "Проверить баланс" };
    }
    return null;
  }, [error]);

  const composerState = useMemo(() => {
    if (isSending) return "sending";
    return "idle";
  }, [isSending]);

  const composerStatusLabel = useMemo(() => {
    if (composerState === "sending") return "Отправка...";
    return isOnline ? "Готово" : "Нет сети";
  }, [composerState, isOnline]);

  const estimatedCostLabel = useMemo(() => {
    if (!selectedModelInfo?.pricing) return "—";
    if (!Number.isFinite(estimatedUsd)) return "—";
    return `$${estimatedUsd.toFixed(4)}`;
  }, [estimatedUsd, selectedModelInfo]);

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
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorCode =
          typeof data?.code === "string" ? data.code : undefined;
        const errorMessage =
          typeof data?.error === "string" ? data.error : "Ошибка запроса к модели.";

        if (response.status === 401) {
          if (
            errorCode === "OPENROUTER_KEY_MISSING" ||
            errorMessage.includes("OPENROUTER_API_KEY")
          ) {
            setApiKeyState("missing");
            return;
          }

          if (errorCode === "OPENROUTER_KEY_INVALID") {
            setApiKeyState("invalid");
            setError((prev) => prev ?? "OpenRouter: ключ платформы недействителен.");
            return;
          }

          if (errorCode === "AUTH_UNAUTHORIZED" || errorMessage === "Unauthorized") {
            setApiKeyState("ok");
            setError((prev) => prev ?? "Сессия истекла. Войдите снова.");
            return;
          }
        }
        setApiKeyState("ok");
        return;
      }
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
      setApiKeyState("ok");
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
      const confirmed = window.confirm("Удалить чат навсегда?");
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

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (!composerRef.current) return;
    resizeComposer(composerRef.current);
  }, [input]);

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
          typeof data?.data?.billingTierLabel === "string"
            ? data.data.billingTierLabel
            : typeof settings?.planName === "string"
              ? settings.planName
              : "Free";
        setShowOnboarding(!onboarded);
        setCurrentUser({
          email: data?.data?.email ?? null,
          role: data?.data?.role ?? null,
          planName,
          displayName: displayName || "Пользователь",
          image: data?.data?.image ?? null,
          emailVerifiedByProvider:
            typeof data?.data?.emailVerifiedByProvider === "boolean" ||
            data?.data?.emailVerifiedByProvider === null
              ? data.data.emailVerifiedByProvider
              : null,
        });
      } catch {
        // ignore
      }
    }
    void loadProfile();
  }, []);

  const needsEmailVerification = useMemo(() => {
    if (!currentUser) return false;
    if (!currentUser.email) return true;
    return currentUser.emailVerifiedByProvider !== true;
  }, [currentUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const headerElement = headerRef.current;
    const composerElement = composerContainerRef.current;

    const updateOffsets = () => {
      setHeaderOffset(headerElement?.offsetHeight ?? 0);
      setComposerOffset(composerElement?.offsetHeight ?? 0);
    };

    updateOffsets();

    const resizeObserver = new ResizeObserver(() => {
      updateOffsets();
    });

    if (headerElement) {
      resizeObserver.observe(headerElement);
    }

    if (composerElement) {
      resizeObserver.observe(composerElement);
    }

    window.addEventListener("resize", updateOffsets);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOffsets);
    };
  }, [
    attachments.length,
    isSending,
    modelMenuOpen,
    needsEmailVerification,
    showOnboarding,
  ]);

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
    if (isSending && streamingChatId && activeChatId !== streamingChatId) {
      abortControllerRef.current?.abort();
      setIsSending(false);
      setStreamingChatId(null);
    }

    if (!activeChatId) {
      setMessages([]);
      setAttachments([]);
      return;
    }

    if (skipNextLoadRef.current === activeChatId) {
      skipNextLoadRef.current = null;
      return;
    }

    // Keep local streaming/placeholder UI intact while the current chat is receiving SSE chunks.
    if (isSending && streamingChatId === activeChatId) {
      return;
    }

    void loadChatDetails(activeChatId);
  }, [activeChatId, loadChatDetails, isSending, streamingChatId]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedModel) return;
    window.localStorage.setItem("platformaai:model", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (isSending) {
      const container = chatScrollRef.current;
      if (container) {
        if (!shouldAutoScrollRef.current) return;
        container.scrollTop = container.scrollHeight;
        return;
      }
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
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

  async function ensureChatId(title = "Новый чат") {
    if (activeChatId) return activeChatId;
    const chatId = await createChat(title);
    return chatId;
  }

  async function persistUserMessage(chatId: string, content: string) {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        role: "USER",
        content,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error ?? "Не удалось сохранить сообщение.");
    }
  }

  async function handleDescribeAttachment(attachment: Attachment) {
    if (!activeChatId) return;
    if (!attachment.mimeType.startsWith("image/")) return;
    shouldAutoScrollRef.current = true;
    setIsSending(true);
    try {
      const response = await fetch("/api/ai/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId: attachment.id, chatId: activeChatId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data?.error ?? "Не удалось создать описание.");
        return;
      }
      await loadChatDetails(activeChatId);
    } finally {
      setIsSending(false);
    }
  }

  async function runAssistant(chatId: string, messageList: ChatMessage[]) {
    const assistantIndex = messageList.length;
    shouldAutoScrollRef.current = true;
    setMessages([...messageList, { role: "assistant", content: "" }]);
    setIsSending(true);
    setStreamingChatId(chatId);

    if (!activeChatIdRef.current) {
      skipNextLoadRef.current = chatId;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
        setError(data?.error ?? "Ошибка запроса к модели.");
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
                if (activeChatIdRef.current !== chatId) return prev;
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
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }
      throw error;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsSending(false);
      setStreamingChatId(null);
      await loadChats();
      if (activeChatIdRef.current === chatId) {
        await loadChatDetails(chatId);
      }
    }
  }

  async function runImageGenerationInChat(chatId: string, text: string) {
    shouldAutoScrollRef.current = true;
    setMessages([
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: IMAGE_GENERATION_LOADING_CONTENT },
    ]);
    setIsSending(true);
    setStreamingChatId(chatId);

    if (!activeChatIdRef.current) {
      skipNextLoadRef.current = chatId;
    }

    try {
      const response = await fetch("/api/ai/chat-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          prompt: text,
          modelId: undefined,
          aspectRatio: "1:1",
          imageSize: "1K",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Не удалось сгенерировать изображение.");
      }
    } finally {
      setIsSending(false);
      setStreamingChatId(null);
      await loadChats();
      if (activeChatIdRef.current === chatId) {
        await loadChatDetails(chatId);
      }
    }
  }

  function getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    setError(null);
    setInput("");
    shouldAutoScrollRef.current = true;

    const chatId = await ensureChatId(text.slice(0, 40) || "Новый чат");
    if (!chatId) {
      setError("Не удалось создать чат.");
      return;
    }

    const imageIntent = detectImageGenerationIntent(text);
    if (imageIntent.isImageGeneration) {
      try {
        await runImageGenerationInChat(chatId, imageIntent.prompt);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Не удалось сгенерировать изображение."));
      }
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);

    try {
      await persistUserMessage(chatId, text);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Не удалось отправить сообщение."));
      setMessages(messages);
      return;
    }

    try {
      await runAssistant(chatId, nextMessages);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Не удалось отправить сообщение."));
    }
  }

  async function sendQuickPrompt(text: string) {
    if (!text.trim() || isSending) return;
    setError(null);
    shouldAutoScrollRef.current = true;
    const chatId = await ensureChatId(text.slice(0, 40) || "Новый чат");
    if (!chatId) return;

    const imageIntent = detectImageGenerationIntent(text);
    if (imageIntent.isImageGeneration) {
      try {
        await runImageGenerationInChat(chatId, imageIntent.prompt);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Не удалось сгенерировать изображение."));
      }
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);

    try {
      await persistUserMessage(chatId, text);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Не удалось отправить сообщение."));
      setMessages(messages);
      return;
    }

    try {
      await runAssistant(chatId, nextMessages);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Не удалось отправить сообщение."));
    }
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
    const chatId = activeChatId ?? (await ensureChatId("Новый чат"));
    if (!chatId) return;

    try {
      const response = await fetch(`/api/messages/${editingMessageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingText.trim(), rollback: true }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Не удалось обновить сообщение.");
      }

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
    } catch (error) {
      setError(getErrorMessage(error, "Не удалось обновить сообщение."));
    }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function handleStopGeneration() {
    abortControllerRef.current?.abort();
  }

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };
  const toggleDesktopSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };
  const handleChatScroll = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    shouldAutoScrollRef.current = isNearBottom(container);
  }, []);

  return (
    <div className="relative z-10 flex h-[100dvh] w-full overflow-hidden text-text-main font-display">
      {isSidebarOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          aria-label="Закрыть меню"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      )}
      <aside
        className={`fixed inset-y-2 left-2 z-40 flex h-[calc(100dvh-1rem)] w-[min(18rem,calc(100vw-1rem))] flex-col glass-panel border-r-0 border-r-black/5 transition-all duration-300 transform md:static md:inset-auto md:h-full md:w-72 md:translate-x-0 ${isSidebarCollapsed ? "md:w-20" : "md:w-72"} ${isSidebarOpen ? "translate-x-0" : "-translate-x-[120%]"
          }`}
      >
        <div className={`${isSidebarCollapsed ? "p-4 pb-2" : "p-4 pb-2 md:p-6 md:pb-2"}`}>
          <div className={`mb-6 flex items-start ${isSidebarCollapsed ? "justify-center gap-2" : "justify-between gap-3"}`}>
            <div className={`flex min-w-0 flex-col gap-1 ${isSidebarCollapsed ? "items-center" : ""}`}>
              <h1 className={`text-text-primary font-bold tracking-tight ${isSidebarCollapsed ? "text-base" : "text-xl"}`}>
                {isSidebarCollapsed ? (
                  <>
                    P<span className="text-primary">A</span>
                  </>
                ) : (
                  <>
                    Platforma<span className="text-primary">AI</span>
                  </>
                )}
              </h1>
              {!isSidebarCollapsed && (
                <p className="text-text-secondary text-xs font-normal">Единый агрегатор LLM</p>
              )}
            </div>
            <button
              className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary md:flex"
              onClick={toggleDesktopSidebar}
              type="button"
              aria-label={isSidebarCollapsed ? "Развернуть боковую панель" : "Свернуть боковую панель"}
              title={isSidebarCollapsed ? "Развернуть" : "Свернуть"}
            >
              <span className="material-symbols-outlined text-[18px]">
                {isSidebarCollapsed ? "right_panel_open" : "left_panel_close"}
              </span>
            </button>
          </div>
          <button
            className={`w-full flex items-center justify-center bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors shadow-[0_0_15px_rgba(212,122,106,0.2)] group mb-4 ${isSidebarCollapsed ? "p-2.5" : "gap-2 p-3"}`}
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
            {!isSidebarCollapsed && <span className="text-sm font-bold">Новый чат</span>}
          </button>

          <Link
            href="/images"
            className={`mb-4 flex w-full items-center justify-center rounded-lg border border-black/10 bg-white/70 text-text-primary transition-colors hover:bg-white hover:text-primary ${isSidebarCollapsed ? "p-2.5" : "gap-2 p-3"}`}
            onClick={closeSidebar}
            title="Изображения"
          >
            <span className="material-symbols-outlined text-[20px]">
              imagesmode
            </span>
            {!isSidebarCollapsed && <span className="text-sm font-bold">Изображения</span>}
          </Link>

          {isSidebarCollapsed ? (
            <div className="mb-4 flex justify-center">
              <button
                className="hidden md:flex size-10 items-center justify-center rounded-lg border border-black/10 bg-white/70 text-text-secondary transition-colors hover:text-text-primary hover:bg-white"
                type="button"
                title="Развернуть и искать"
                aria-label="Развернуть и искать"
                onClick={() => setIsSidebarCollapsed(false)}
              >
                <span className="material-symbols-outlined text-[18px]">search</span>
              </button>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <div className="relative">
                  <span className="material-symbols-outlined text-[16px] text-text-secondary absolute left-3 top-1/2 -translate-y-1/2">
                    search
                  </span>
                  <input
                    className="w-full rounded-lg border border-black/10 bg-white/70 py-2 pl-9 pr-10 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Поиск по чатам..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery.trim() && (
                    <button
                      className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary md:size-8"
                      type="button"
                      onClick={() => setSearchQuery("")}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        close
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs font-medium text-text-secondary/70 uppercase tracking-wider mb-3 px-2">
                Недавние чаты
              </div>
            </>
          )}
        </div>

        <div
          className={`flex-1 overflow-y-auto pb-4 space-y-2 scrollbar-hide ${isSidebarCollapsed ? "px-2" : "px-4"}`}
        >
          {chatGroups.map((group) => (
            <div key={group.label}>
              {group.items.map((chat) => (
                <div
                  key={chat.id}
                  title={isSidebarCollapsed ? chat.title : undefined}
                  className={`flex items-center rounded-lg cursor-pointer transition-colors group ${isSidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-3"} ${chat.id === activeChatId
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
                  {!isSidebarCollapsed && (
                    <>
                      <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${chat.id === activeChatId ? "text-text-primary" : "text-text-primary group-hover:text-text-primary"
                          }`}>
                          {chat.title}
                        </p>
                        <p className="text-text-secondary text-[10px] truncate">
                          {new Date(chat.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                        <button
                          className={`flex min-h-10 min-w-10 items-center justify-center rounded-md transition-colors md:min-h-8 md:min-w-8 ${chat.pinned ? "bg-primary/10 text-primary" : "text-text-secondary hover:text-text-primary hover:bg-black/5"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleTogglePin(chat);
                          }}
                          type="button"
                          title={chat.pinned ? "Открепить" : "Закрепить"}
                        >
                          <span className="material-symbols-outlined text-[16px]">push_pin</span>
                        </button>
                        <button
                          className={`flex min-h-10 min-w-10 items-center justify-center rounded-md transition-colors md:min-h-8 md:min-w-8 ${chat.isFavorite ? "bg-amber-100 text-amber-600" : "text-text-secondary hover:text-text-primary hover:bg-black/5"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggleFavorite(chat);
                          }}
                          type="button"
                          title={chat.isFavorite ? "Убрать из избранного" : "В избранное"}
                        >
                          <span className="material-symbols-outlined text-[16px]">star</span>
                        </button>
                        <button
                          className="flex min-h-10 min-w-10 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-red-50 hover:text-red-600 md:min-h-8 md:min-w-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteChat(chat.id);
                          }}
                          type="button"
                          title="Удалить"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
          {!filteredChats.length && (
            <div className={`text-xs text-text-secondary ${isSidebarCollapsed ? "px-1 text-center" : "px-3"}`}>
              {isSidebarCollapsed ? "—" : "Нет недавних чатов."}
            </div>
          )}
        </div>

        <div className={`border-t border-black/10 ${isSidebarCollapsed ? "p-2" : "p-4 pt-3"}`}>
          {isSidebarCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="size-10 rounded-full bg-gray-300 ring-2 ring-black/10 flex items-center justify-center text-text-secondary font-bold"
                style={
                  currentUser?.image
                    ? { backgroundImage: `url(${currentUser.image})`, backgroundSize: "cover" }
                    : undefined
                }
                title={currentUser?.displayName || "Пользователь"}
              >
                {!currentUser?.image && (currentUser?.displayName?.[0] || "U")}
              </div>
              <Link
                href="/settings"
                className="flex size-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                onClick={closeSidebar}
                aria-label="Настройки"
                title="Настройки"
              >
                <span className="material-symbols-outlined text-[18px]">settings</span>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-black/10 bg-black/5 px-3 py-2">
              <div
                className="size-9 rounded-full bg-gray-300 ring-2 ring-black/10 flex items-center justify-center text-text-secondary font-bold"
                style={
                  currentUser?.image
                    ? { backgroundImage: `url(${currentUser.image})`, backgroundSize: "cover" }
                    : undefined
                }
              >
                {!currentUser?.image && (currentUser?.displayName?.[0] || "U")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">
                  {currentUser?.displayName || "Пользователь"}
                </p>
                <p className="truncate text-xs text-text-secondary">
                  {currentUser?.planName || "Free"}
                </p>
              </div>
              <Link
                href="/settings"
                className="flex size-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                onClick={closeSidebar}
                aria-label="Настройки"
                title="Настройки"
              >
                <span className="material-symbols-outlined text-[20px]">settings</span>
              </Link>
            </div>
          )}
        </div>

      </aside>

      <main className="relative flex h-full min-w-0 flex-1 flex-col">
        {/* Floating Header */}
        <header
          ref={headerRef}
          className="pointer-events-none absolute top-0 left-0 right-0 z-30 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 md:px-6 md:py-4"
        >
          <div className="space-y-3 pointer-events-auto">
            {needsEmailVerification && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <p className="max-w-2xl">
                    {!currentUser?.email
                      ? "Добавьте email в настройках, чтобы можно было купить тариф."
                      : "Подтвердите email в настройках, чтобы можно было купить тариф."}
                  </p>
                  <Link
                    href="/settings"
                    className="inline-flex h-9 shrink-0 items-center rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                  >
                    Открыть настройки
                  </Link>
                </div>
              </div>
            )}
            <div className="glass-panel flex items-center justify-between gap-3 rounded-xl px-3 py-3 shadow-lg sm:px-4">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <button
                  className="md:hidden inline-flex size-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                  onClick={() => setIsSidebarOpen(true)}
                >
                  <span className="material-symbols-outlined">menu</span>
                </button>
                <h2 className="min-w-0 truncate text-base font-bold leading-tight text-text-primary md:text-lg">
                  {activeChat ? activeChat.title : "Новый чат"}
                </h2>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <div className="relative" ref={modelMenuRef}>
                {apiKeyState === "ok" ? (
                  <button
                    type="button"
                    className="inline-flex h-9 max-w-[11rem] items-center justify-center gap-x-2 rounded-lg border border-primary/20 bg-primary/10 pl-2 pr-3 text-left transition-colors hover:bg-primary/20"
                    onClick={() => setModelMenuOpen(!modelMenuOpen)}
                  >
                    <span className="material-symbols-outlined text-primary text-[18px]">smart_toy</span>
                    <p className="hidden truncate text-xs font-bold text-primary sm:block">
                      {selectedModelInfo?.name ?? "GPT-4"}
                    </p>
                  </button>
                ) : (
                  <div className="inline-flex h-9 items-center justify-center gap-x-2 rounded-lg border border-amber-300 bg-amber-50 pl-2 pr-3">
                    <span className="material-symbols-outlined text-amber-700 text-[18px]">
                      key
                    </span>
                    <p className="hidden text-xs font-bold text-amber-700 sm:block">
                      {apiKeyState === "invalid" ? "Проверь OpenRouter" : "Модели недоступны"}
                    </p>
                  </div>
                )}

                {apiKeyState === "ok" && modelMenuOpen && (
                  <div className="absolute right-0 top-full z-20 mt-2 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-white/60 bg-white/90 p-2 shadow-glass-lg backdrop-blur-md sm:w-72">
                    <div className="px-1 pb-2">
                      <div className="relative">
                        <span className="material-symbols-outlined text-[16px] text-text-secondary absolute left-3 top-1/2 -translate-y-1/2">
                          search
                        </span>
                        <input
                          className="w-full rounded-lg border border-black/10 bg-white/80 py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Поиск моделей"
                          value={modelQuery}
                          onChange={(event) => setModelQuery(event.target.value)}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {([
                          { id: "all", label: "Все" },
                          { id: "fast", label: "Быстрые" },
                          { id: "cheap", label: "Дешевые" },
                          { id: "long", label: "Длинный контекст" },
                        ] as const).map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${modelFilter === filter.id ? "bg-primary/15 text-primary" : "text-text-secondary hover:text-text-primary hover:bg-black/5"}`}
                            onClick={() => setModelFilter(filter.id)}
                          >
                            {filter.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto px-1 pb-1">
                      {filteredModels.map((model) => (
                        <button
                          key={model.id}
                          className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${selectedModel === model.id ? "bg-primary/10 text-primary font-medium" : "text-text-main hover:bg-black/5"}`}
                          onClick={() => void handleSelectModel(model.id)}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span>{model.name}</span>
                            <span className="text-[10px] text-text-secondary">
                              {formatPricing(model.pricing)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              </div>
            </div>
          </div>
        </header>

        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="chat-scroll-fade-top flex-1 overflow-y-auto px-3 sm:px-4 md:px-6"
          style={{
            paddingTop: `${Math.max(headerOffset + 12, 112)}px`,
            paddingBottom: `${Math.max(
              composerOffset + 16,
              96
            )}px`,
          }}
        >
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-semibold">Что-то пошло не так</p>
                    <p className="text-xs text-amber-800">{error}</p>
                    {errorHint && (
                      <p className="text-xs text-amber-700">{errorHint}</p>
                    )}
                  </div>
                  <button
                    className="inline-flex size-8 items-center justify-center rounded-lg text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900"
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="Закрыть"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                {errorCta && (
                  <div className="mt-2">
                  <Link
                    href={errorCta.href}
                    className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900"
                    >
                      {errorCta.label}
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  </div>
                )}
              </div>
            )}

            {showOnboarding && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text-primary">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">Завершите настройку профиля</p>
                    <p className="text-xs text-text-secondary">
                      Заполните профиль в настройках, чтобы продолжить работу.
                    </p>
                  </div>
                  <button
                    className="inline-flex size-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                    type="button"
                    onClick={() => setShowOnboarding(false)}
                    aria-label="Закрыть"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                <div className="mt-2">
                  <Link
                    href="/settings"
                    className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 hover:text-primary-hover"
                  >
                    Завершить настройку
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </Link>
                </div>
              </div>
            )}
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="size-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg ring-1 ring-black/10 mb-6">
                  <span className="material-symbols-outlined text-white text-[32px]">smart_toy</span>
                </div>
                <h1 className="text-2xl font-bold text-text-main font-display mb-2">Здравствуйте! Я готов помочь.</h1>
                <p className="text-text-secondary text-sm mb-8">Выберите подсказку или введите свой запрос.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl px-4">
                  {[
                    { icon: "lightbulb", color: "text-orange-500", title: "Идеи", subtitle: "Название бренда кофе", prompt: "Придумай 10 названий для нового бренда кофе." },
                    { icon: "code", color: "text-blue-500", title: "Код", subtitle: "Функция сортировки на Python", prompt: "Напиши функцию Python для сортировки списка." },
                    { icon: "edit_note", color: "text-green-500", title: "Редактирование", subtitle: "Проверка грамматики", prompt: "Проверь грамматику в этом тексте." },
                    { icon: "translate", color: "text-purple-500", title: "Перевод", subtitle: "На испанский", prompt: "Переведи это на испанский." }
                  ].map((item) => (
                    <button
                      key={item.title}
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
                  const generatedImage = isAI
                    ? parseGeneratedImageMessage(message.content)
                    : null;
                  const isEditing =
                    !isAI && Boolean(message.id) && editingMessageId === message.id;
                  const tokenCount =
                    typeof message.tokenCount === "number"
                      ? message.tokenCount
                      : 0;
                  const isStreamingAssistant =
                    isAI && isSending && index === messages.length - 1;
                  const showThinkingPanel =
                    isStreamingAssistant && !message.content.trim();
                return (
                  <div key={message.id || index} className={`group flex items-start gap-2 sm:gap-4 ${isAI ? 'pr-0 sm:pr-4' : 'justify-end pl-0 sm:pl-4'}`}>
                    {isAI && (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg ring-1 ring-black/10 sm:size-10">
                        <span className="material-symbols-outlined text-white text-[20px]">smart_toy</span>
                      </div>
                    )}

                    <div className={`flex w-full max-w-[92%] flex-col gap-2 sm:max-w-[85%] md:max-w-[75%] ${!isAI && 'items-end'}`}>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-bold text-text-primary">{isAI ? "PlatformaAI" : "Вы"}</span>
                        <span className="text-xs text-text-secondary" suppressHydrationWarning>
                          {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className={`p-4 text-sm leading-relaxed text-text-primary shadow-sm md:p-5 md:text-base
                                    ${isAI
                          ? 'glass-message-ai rounded-3xl rounded-tl-sm'
                          : 'glass-panel bg-white/95 text-text-primary border border-primary/30 rounded-3xl rounded-tr-sm shadow-[0_4px_20px_rgba(212,122,106,0.15)] overflow-hidden relative'
                        }
                                `}>
                        {!isAI && <div className="absolute inset-0 bg-gradient-to-br from-white/70 via-white/30 to-transparent pointer-events-none"></div>}

                        <div className="relative z-10">
                          {isAI ? (
                            showThinkingPanel ? (
                              <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-white/50 px-3 py-2">
                                <span className="material-symbols-outlined text-primary text-[18px] animate-pulse">
                                  psychology
                                </span>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-sm font-semibold text-text-primary">
                                    Думает над ответом...
                                  </span>
                                  <span className="text-[11px] text-text-secondary">
                                    Печатает по мере генерации
                                  </span>
                                </div>
                                <div className="ml-auto flex items-center gap-1" aria-hidden>
                                  <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.2s]" />
                                  <span className="size-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.1s]" />
                                  <span className="size-1.5 rounded-full bg-primary/60 animate-bounce" />
                                </div>
                              </div>
                            ) : message.content === IMAGE_GENERATION_LOADING_CONTENT ? (
                              <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-white/60 px-3 py-2">
                                <span className="material-symbols-outlined animate-pulse text-[18px] text-primary">
                                  imagesmode
                                </span>
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-sm font-semibold text-text-primary">
                                    Генерирую изображение...
                                  </span>
                                  <span className="text-[11px] text-text-secondary">
                                    Результат появится в чате и в галерее
                                  </span>
                                </div>
                              </div>
                            ) : generatedImage ? (
                              <div className="overflow-hidden rounded-3xl border border-white/80 bg-white/75 shadow-sm">
                                <div className="relative flex min-h-64 items-center justify-center bg-slate-100">
                                  {generatedImage.fileUrl ? (
                                    <Image
                                      fill
                                      unoptimized
                                      src={generatedImage.fileUrl}
                                      alt={generatedImage.prompt}
                                      sizes="(max-width: 768px) 92vw, 640px"
                                      className="object-contain"
                                    />
                                  ) : (
                                    <span className="text-sm text-text-secondary">
                                      Файл изображения недоступен
                                    </span>
                                  )}
                                </div>
                                <div className="space-y-3 p-4">
                                  <div>
                                    <p className="text-sm font-semibold text-text-primary">
                                      Изображение готово
                                    </p>
                                    <p className="mt-1 line-clamp-3 text-sm text-text-secondary">
                                      {generatedImage.prompt}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {generatedImage.fileUrl && (
                                      <a
                                        className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-text-primary transition-colors hover:border-primary/30 hover:text-primary"
                                        href={generatedImage.fileUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Открыть
                                      </a>
                                    )}
                                    <Link
                                      className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/10 bg-white px-3 text-xs font-semibold text-text-primary transition-colors hover:border-primary/30 hover:text-primary"
                                      href="/images"
                                    >
                                      В галерею
                                    </Link>
                                    <span className="inline-flex min-h-9 items-center rounded-full bg-black/5 px-3 text-xs font-semibold text-text-secondary">
                                      {generatedImage.modelId}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeHighlight]}
                                  className="chat-markdown overflow-x-auto"
                                >
                                  {message.content || ""}
                                </ReactMarkdown>
                                {isStreamingAssistant && (
                                  <span
                                    className="mt-1 inline-block h-4 w-1 rounded-full bg-primary/70 animate-pulse"
                                    aria-hidden
                                  />
                                )}
                              </div>
                            )
                          ) : (
                            <>
                              {isEditing ? (
                                <div className="space-y-3">
                                  <textarea
                                    className="w-full rounded-xl border border-primary/30 bg-white/90 p-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                                    rows={3}
                                    value={editingText}
                                    onChange={(event) => setEditingText(event.target.value)}
                                  />
                                  <div className="flex justify-end gap-2 text-xs">
                                    <button
                                      className="rounded-full border border-black/10 px-3 py-1.5 text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                                      type="button"
                                      onClick={cancelEditMessage}
                                    >
                                      Отмена
                                    </button>
                                    <button
                                      className="rounded-full bg-primary px-3 py-1.5 text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                                      type="button"
                                      onClick={saveEditMessage}
                                      disabled={!editingText.trim()}
                                    >
                                      Сохранить
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                              )}
                            </>
                          )}
                        </div>

                        {isAI && !showThinkingPanel && (
                          <div className="mt-4 pt-4 border-t border-black/5 flex flex-wrap gap-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/5 border border-black/10">
                              <span className="material-symbols-outlined text-primary text-[14px]">token</span>
                              <span className="text-xs text-text-secondary">
                                Токены: <strong>{tokenCount.toLocaleString()}</strong>
                              </span>
                            </div>
                            <button className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/10 hover:text-text-primary" onClick={() => handleCopy(message.content)}>
                              <span className="material-symbols-outlined text-[16px]">content_copy</span>
                              Копировать
                            </button>
                          </div>
                        )}
                        {!isAI && !isEditing && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                            <button
                              className="flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-black/5 hover:text-text-primary"
                              type="button"
                              onClick={() => startEditMessage(message)}
                            >
                              <span className="material-symbols-outlined text-[14px]">edit</span>
                              Редактировать
                            </button>
                            <button
                              className="flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-black/5 hover:text-text-primary"
                              type="button"
                              onClick={() => handleCopy(message.content)}
                            >
                              <span className="material-symbols-outlined text-[14px]">content_copy</span>
                              Копировать
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {!isAI && (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500 shadow-lg sm:size-10" style={{ backgroundImage: `url(${currentUser?.image})`, backgroundSize: 'cover' }}>
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
        <div
          ref={composerContainerRef}
          className="sticky bottom-0 left-0 right-0 z-20 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:bottom-6 md:px-4 md:pb-0"
        >
          <div className="flex w-full max-w-[720px] flex-col gap-1.5 rounded-3xl p-2 glass-input transition-all focus-within:ring-0 focus-within:shadow-[0_0_0_6px_rgba(212,122,106,0.14)]">
            {attachments.length > 0 && (
              <div className="flex px-3 gap-2 overflow-x-auto py-1">
                {attachments.map(att => (
                  <div key={att.id} className="text-xs bg-white/50 px-2 py-1 rounded-md flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">attach_file</span>
                    <span className="truncate max-w-[100px]">{att.filename}</span>
                    {att.mimeType.startsWith("image/") && (
                      <button
                        className="ml-1 inline-flex size-6 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-black/5 hover:text-text-primary"
                        type="button"
                        title="Описать изображение"
                        onClick={() => handleDescribeAttachment(att)}
                      >
                        <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 px-2 pt-2">
              <textarea
                ref={composerRef}
                className="scrollbar-hide min-h-11 max-h-32 w-full resize-none border-none bg-transparent py-3 text-sm leading-6 text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-0 focus-visible:outline-none md:text-base"
                placeholder="Спросите что угодно или вставьте текст..."
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  resizeComposer(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              ></textarea>

              {isSending ? (
                <button
                  className="inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white transition-colors hover:bg-rose-600 shadow-[0_0_15px_rgba(244,63,94,0.35)] aspect-square"
                  onClick={handleStopGeneration}
                  type="button"
                  aria-label="Остановить генерацию"
                  title="Остановить генерацию"
                >
                  <span className="material-symbols-outlined flex size-5 items-center justify-center leading-none text-[20px]">
                    stop
                  </span>
                </button>
              ) : (
                <button
                  className="inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 shadow-[0_0_15px_rgba(212,122,106,0.4)] disabled:cursor-not-allowed disabled:opacity-50 aspect-square"
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  type="button"
                >
                  <span className="material-symbols-outlined flex size-5 items-center justify-center leading-none text-[20px]">
                    arrow_upward
                  </span>
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 pb-2 pt-1">
              <span
                className={`text-[10px] font-mono font-semibold ${composerState === "idle" ? "text-text-secondary/70" : "text-primary"}`}
              >
                {composerStatusLabel}
              </span>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] font-mono text-text-secondary/70">
                <span className="hidden sm:inline">Оценка: {estimatedCostLabel}</span>
                <span className="hidden md:inline">
                  {estimatedPromptTokens.toLocaleString()} ток.
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
