"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [isUploading, setIsUploading] = useState(false);
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
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const skipNextLoadRef = useRef<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const appliedPromptRef = useRef<string | null>(null);

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
      return "Sign in again.";
    }
    if (
      lower.includes("openrouter") ||
      lower.includes("api key") ||
      lower.includes("неверный ключ")
    ) {
      return "Check OpenRouter API key.";
    }
    if (lower.includes("openrouter")) {
      return "Try another model or try again later.";
    }
    if (lower.includes("balance")) {
      return "Top up balance or switch to free model.";
    }
    return "Check connection and try again.";
  }, [error]);

  const errorCta = useMemo(() => {
    if (!error) return null;
    const lower = error.toLowerCase();
    if (
      lower === "unauthorized" ||
      lower.includes("auth_unauthorized") ||
      lower.includes("сессия истекла")
    ) {
      return { href: "/login", label: "Sign In" };
    }
    if (
      lower.includes("openrouter") ||
      lower.includes("api key") ||
      lower.includes("неверный ключ")
    ) {
      return { href: "/settings#api-keys", label: "Check Key" };
    }
    if (lower.includes("balance")) {
      return { href: "/settings", label: "Open Settings" };
    }
    return null;
  }, [error]);

  const composerState = useMemo(() => {
    if (isUploading) return "uploading";
    if (isSending) return "sending";
    return "idle";
  }, [isUploading, isSending]);

  const composerStatusLabel = useMemo(() => {
    if (composerState === "uploading") return "Uploading...";
    if (composerState === "sending") return "Sending...";
    return isOnline ? "Ready" : "Offline";
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
          typeof data?.error === "string" ? data.error : "Model request error.";

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
            setError((prev) => prev ?? "OpenRouter: неверный ключ. Проверьте ключ в настройках.");
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
    if (isSending && streamingChatId && activeChatId !== streamingChatId) {
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

  async function ensureChatId(title = "New Chat") {
    if (activeChatId) return activeChatId;
    const chatId = await createChat(title);
    return chatId;
  }

  async function persistUserMessage(chatId: string, content: string) {
    const tokenCount = estimateTokens(content);

    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        role: "USER",
        content,
        tokenCount,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error ?? "Failed to save message.");
    }
  }

  async function handleUpload(file: File, targetChatId?: string) {
    const chatId = targetChatId ?? (await ensureChatId(
      file.name ? file.name.slice(0, 40) : "New Chat"
    ));
    if (!chatId) return;

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
    shouldAutoScrollRef.current = true;
    setMessages([...messageList, { role: "assistant", content: "" }]);
    setIsSending(true);
    setStreamingChatId(chatId);

    if (!activeChatIdRef.current) {
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

    try {
      await persistUserMessage(chatId, text);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to send message."));
      setMessages(messages);
      return;
    }

    try {
      await runAssistant(chatId, nextMessages);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to send message."));
    }
  }

  async function sendQuickPrompt(text: string) {
    if (!text.trim() || isSending) return;
    setError(null);
    shouldAutoScrollRef.current = true;
    const chatId = await ensureChatId(text.slice(0, 40) || "New Chat");
    if (!chatId) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);

    try {
      await persistUserMessage(chatId, text);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to send message."));
      setMessages(messages);
      return;
    }

    try {
      await runAssistant(chatId, nextMessages);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to send message."));
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
    const chatId = activeChatId ?? (await ensureChatId("New Chat"));
    if (!chatId) return;

    try {
      const response = await fetch(`/api/messages/${editingMessageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingText.trim(), rollback: true }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to update message.");
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
      setError(getErrorMessage(error, "Failed to update message."));
    }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
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
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-72 flex-col glass-panel border-r-0 border-r-black/5 transition-all duration-300 transform md:static md:z-20 md:translate-x-0 ${isSidebarCollapsed ? "md:w-20" : "md:w-72"} ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        <div className={`${isSidebarCollapsed ? "p-4 pb-2" : "p-6 pb-2"}`}>
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
                <p className="text-text-secondary text-xs font-normal">Unified LLM Aggregator</p>
              )}
            </div>
            <button
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-black/5"
              onClick={toggleDesktopSidebar}
              type="button"
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={isSidebarCollapsed ? "Expand" : "Collapse"}
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
            {!isSidebarCollapsed && <span className="text-sm font-bold">New Chat</span>}
          </button>

          {isSidebarCollapsed ? (
            <div className="mb-4 flex justify-center">
              <button
                className="hidden md:flex size-10 items-center justify-center rounded-lg border border-black/10 bg-white/70 text-text-secondary hover:text-text-primary hover:bg-white"
                type="button"
                title="Expand and search"
                aria-label="Expand and search"
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
                    className="w-full rounded-lg border border-black/10 bg-white/70 pl-9 pr-9 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Search chats..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery.trim() && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
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
                Recent Sessions
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
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className={`size-7 flex items-center justify-center rounded-md ${chat.pinned ? "bg-primary/10 text-primary" : "text-text-secondary hover:text-text-primary hover:bg-black/5"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleTogglePin(chat);
                          }}
                          type="button"
                          title={chat.pinned ? "Unpin" : "Pin"}
                        >
                          <span className="material-symbols-outlined text-[16px]">push_pin</span>
                        </button>
                        <button
                          className={`size-7 flex items-center justify-center rounded-md ${chat.isFavorite ? "bg-amber-100 text-amber-600" : "text-text-secondary hover:text-text-primary hover:bg-black/5"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleToggleFavorite(chat);
                          }}
                          type="button"
                          title={chat.isFavorite ? "Unfavorite" : "Favorite"}
                        >
                          <span className="material-symbols-outlined text-[16px]">star</span>
                        </button>
                        <button
                          className="size-7 flex items-center justify-center rounded-md text-text-secondary hover:text-red-600 hover:bg-red-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteChat(chat.id);
                          }}
                          type="button"
                          title="Delete"
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
              {isSidebarCollapsed ? "—" : "No recent sessions."}
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
                title={currentUser?.displayName || "User"}
              >
                {!currentUser?.image && (currentUser?.displayName?.[0] || "U")}
              </div>
              <Link
                href="/settings"
                className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-black/5 hover:text-text-primary"
                onClick={closeSidebar}
                aria-label="Settings"
                title="Settings"
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
                  {currentUser?.displayName || "User"}
                </p>
                <p className="truncate text-xs text-text-secondary">
                  {currentUser?.planName || "Pro Plan"}
                </p>
              </div>
              <Link
                href="/settings"
                className="flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-black/5 hover:text-text-primary"
                onClick={closeSidebar}
                aria-label="Settings"
                title="Settings"
              >
                <span className="material-symbols-outlined text-[20px]">settings</span>
              </Link>
            </div>
          )}
        </div>

      </aside>

      <main
        className="flex-1 flex flex-col relative h-full"
      >
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
              <h2 className="text-text-primary text-base md:text-lg font-bold leading-tight">
                {activeChat ? activeChat.title : "New Session"}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative" ref={modelMenuRef}>
                {apiKeyState === "ok" ? (
                  <div
                    className="hidden md:flex h-8 items-center justify-center gap-x-2 rounded-lg bg-primary/10 border border-primary/20 pl-2 pr-3 cursor-pointer hover:bg-primary/20 transition-colors"
                    onClick={() => setModelMenuOpen(!modelMenuOpen)}
                  >
                    <span className="material-symbols-outlined text-primary text-[18px]">smart_toy</span>
                    <p className="text-primary text-xs font-bold">
                      {selectedModelInfo?.name ?? "GPT-4"}
                    </p>
                  </div>
                ) : (
                  <Link
                    href="/settings#api-keys"
                    className="hidden md:flex h-8 items-center justify-center gap-x-2 rounded-lg bg-amber-50 border border-amber-300 pl-2 pr-3 hover:bg-amber-100 transition-colors"
                  >
                    <span className="material-symbols-outlined text-amber-700 text-[18px]">
                      key
                    </span>
                    <p className="text-amber-700 text-xs font-bold">
                      {apiKeyState === "invalid"
                        ? "Проверь API-ключ"
                        : "Добавить API-ключ"}
                    </p>
                  </Link>
                )}

                {apiKeyState === "ok" && modelMenuOpen && (
                  <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-xl border border-white/60 bg-white/90 p-2 shadow-glass-lg backdrop-blur-md">
                    <div className="px-1 pb-2">
                      <div className="relative">
                        <span className="material-symbols-outlined text-[16px] text-text-secondary absolute left-3 top-1/2 -translate-y-1/2">
                          search
                        </span>
                        <input
                          className="w-full rounded-lg border border-black/10 bg-white/80 pl-9 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-secondary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Search models"
                          value={modelQuery}
                          onChange={(event) => setModelQuery(event.target.value)}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {([
                          { id: "all", label: "All" },
                          { id: "fast", label: "Fast" },
                          { id: "cheap", label: "Cheap" },
                          { id: "long", label: "Long" },
                        ] as const).map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            className={`rounded-full px-2 py-0.5 text-[10px] ${modelFilter === filter.id ? "bg-primary/15 text-primary" : "text-text-secondary hover:text-text-primary hover:bg-black/5"}`}
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
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${selectedModel === model.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-black/5 text-text-main"}`}
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
        </header>

        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="chat-scroll-fade-top flex-1 overflow-y-auto pt-24 pb-10 md:pb-12 px-6 md:px-0"
        >
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-semibold">Something went wrong</p>
                    <p className="text-xs text-amber-800">{error}</p>
                    {errorHint && (
                      <p className="text-xs text-amber-700">{errorHint}</p>
                    )}
                  </div>
                  <button
                    className="text-amber-700 hover:text-amber-900"
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="Dismiss"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                {errorCta && (
                  <div className="mt-2">
                    <Link
                      href={errorCta.href}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-900"
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
                    <p className="font-semibold">Complete your onboarding</p>
                    <p className="text-xs text-text-secondary">
                      Add profile details, keys, and limits to personalize the workspace.
                    </p>
                  </div>
                  <button
                    className="text-text-secondary hover:text-text-primary"
                    type="button"
                    onClick={() => setShowOnboarding(false)}
                    aria-label="Dismiss"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>
                <div className="mt-2">
                  <Link
                    href="/settings"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover"
                  >
                    Finish onboarding
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
                <h1 className="text-2xl font-bold text-text-main font-display mb-2">Hello! I&apos;m ready to assist.</h1>
                <p className="text-text-secondary text-sm mb-8">Choose a prompt or type your own.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl px-4">
                  {[
                    { icon: "lightbulb", color: "text-orange-500", title: "Brainstorm Ideas", subtitle: "Name a coffee brand", prompt: "Придумай 10 названий для нового бренда кофе." },
                    { icon: "code", color: "text-blue-500", title: "Write Code", subtitle: "Python sort function", prompt: "Напиши функцию Python для сортировки списка." },
                    { icon: "edit_note", color: "text-green-500", title: "Edit", subtitle: "Check grammar", prompt: "Проверь грамматику в этом тексте." },
                    { icon: "translate", color: "text-purple-500", title: "Translate", subtitle: "To Spanish", prompt: "Переведи это на испанский." }
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
                  const isEditing =
                    !isAI && Boolean(message.id) && editingMessageId === message.id;
                  const tokenCount =
                    typeof message.tokenCount === "number"
                      ? message.tokenCount
                      : estimateTokens(message.content);
                  const isStreamingAssistant =
                    isAI && isSending && index === messages.length - 1;
                  const showThinkingPanel =
                    isStreamingAssistant && !message.content.trim();
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
                        <span className="text-xs text-text-secondary" suppressHydrationWarning>
                          {new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
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
                            ) : (
                              <div>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeHighlight]}
                                  className="chat-markdown"
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
                                      className="rounded-full border border-black/10 px-3 py-1 text-text-secondary hover:text-text-primary"
                                      type="button"
                                      onClick={cancelEditMessage}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      className="rounded-full bg-primary px-3 py-1 text-white disabled:opacity-50"
                                      type="button"
                                      onClick={saveEditMessage}
                                      disabled={!editingText.trim()}
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="whitespace-pre-wrap">{message.content}</p>
                              )}
                            </>
                          )}
                        </div>

                        {isAI && !showThinkingPanel && (
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
                        {!isAI && !isEditing && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                            <button
                              className="flex items-center gap-1 hover:text-text-primary"
                              type="button"
                              onClick={() => startEditMessage(message)}
                            >
                              <span className="material-symbols-outlined text-[14px]">edit</span>
                              Edit
                            </button>
                            <button
                              className="flex items-center gap-1 hover:text-text-primary"
                              type="button"
                              onClick={() => handleCopy(message.content)}
                            >
                              <span className="material-symbols-outlined text-[14px]">content_copy</span>
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
        <div className="sticky bottom-6 left-0 right-0 z-20 flex justify-center px-4">
          <div className="w-full max-w-[720px] glass-input rounded-3xl p-2 flex flex-col gap-2 transition-all focus-within:ring-0 focus-within:shadow-[0_0_0_6px_rgba(212,122,106,0.14)]">
            {attachments.length > 0 && (
              <div className="flex px-3 gap-2 overflow-x-auto py-1">
                {attachments.map(att => (
                  <div key={att.id} className="text-xs bg-white/50 px-2 py-1 rounded-md flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">attach_file</span>
                    <span className="truncate max-w-[100px]">{att.filename}</span>
                    {att.mimeType.startsWith("image/") && (
                      <button
                        className="ml-1 rounded-full p-0.5 text-text-secondary hover:text-text-primary"
                        type="button"
                        title="Describe image"
                        onClick={() => handleDescribeAttachment(att)}
                      >
                        <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                      </button>
                    )}
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
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  let chatId = activeChatId;
                  if (!chatId) {
                    const fileTitle = files[0]?.name?.slice(0, 40) || "New Chat";
                    chatId = await createChat(fileTitle);
                  }
                  if (!chatId) return;
                  setIsUploading(true);
                  try {
                    for (const file of Array.from(files)) {
                      await handleUpload(file, chatId);
                    }
                  } finally {
                    setIsUploading(false);
                    e.target.value = "";
                  }
                }}
              />

              <textarea
                ref={composerRef}
                className="w-full bg-transparent border-none text-text-primary placeholder-text-secondary focus:ring-0 focus:outline-none focus-visible:outline-none resize-none max-h-32 py-2.5 text-sm md:text-base leading-normal scrollbar-hide"
                placeholder="Ask anything or paste text..."
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

              <button
                className="p-2 bg-primary text-white hover:bg-primary/90 transition-colors rounded-full shrink-0 shadow-[0_0_15px_rgba(212,122,106,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleSend()}
                disabled={!input.trim() || isSending}
              >
                <span className="material-symbols-outlined text-[20px] translate-x-0.5">arrow_upward</span>
              </button>
            </div>
            <div className="flex items-center justify-between px-3 pb-1">
              <span
                className={`text-[10px] font-mono font-semibold ${composerState === "idle" ? "text-text-secondary/70" : "text-primary"}`}
              >
                {composerStatusLabel}
              </span>
              <div className="flex items-center gap-3 text-[10px] text-text-secondary/70 font-mono">
                <span className="hidden sm:inline">Est. {estimatedCostLabel}</span>
                <span className="hidden md:inline">
                  {estimatedPromptTokens.toLocaleString()} tok
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
