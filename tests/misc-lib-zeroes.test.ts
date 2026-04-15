import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pdfParse: vi.fn(),
  parseCsv: vi.fn(),
  extractRawText: vi.fn(),
  stripeCtor: vi.fn(),
}));

vi.mock("pdf-parse", () => ({
  default: mocks.pdfParse,
}));

vi.mock("papaparse", () => ({
  default: {
    parse: mocks.parseCsv,
  },
}));

vi.mock("mammoth", () => ({
  default: {
    extractRawText: mocks.extractRawText,
  },
}));

vi.mock("stripe", () => ({
  default: mocks.stripeCtor,
}));

import { extractTextFromFile } from "@/lib/file-parser";
import { checkModeration } from "@/lib/moderation";
import { getStripe } from "@/lib/stripe";
import { verifyTelegramLogin } from "@/lib/telegram";
import { transcribeAudio } from "@/lib/whisper";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

describe("misc zero-coverage libs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MODERATION_ENABLED;
    delete process.env.MODERATION_BLOCKLIST;
    delete process.env.OPENAI_API_KEY;
    delete process.env.WHISPER_MODEL;
    delete process.env.WHISPER_LANGUAGE;
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("extractTextFromFile handles pdf, docx, csv with fallback, and plain text", async () => {
    mocks.pdfParse.mockResolvedValue({ text: "pdf text" });
    await expect(
      extractTextFromFile({
        buffer: Buffer.from("x"),
        mimeType: "application/pdf",
        filename: "report.bin",
      })
    ).resolves.toBe("pdf text");

    mocks.extractRawText.mockResolvedValue({ value: "docx text" });
    await expect(
      extractTextFromFile({
        buffer: Buffer.from("x"),
        mimeType: "application/octet-stream",
        filename: "report.docx",
      })
    ).resolves.toBe("docx text");

    mocks.parseCsv.mockReturnValue({
      data: [
        ["name", "amount"],
        ["alice", "10"],
      ],
      errors: [],
    });
    await expect(
      extractTextFromFile({
        buffer: Buffer.from("name,amount\nalice,10\n"),
        mimeType: "text/csv",
        filename: "report.csv",
      })
    ).resolves.toBe("name, amount\nalice, 10");

    mocks.parseCsv.mockReturnValue({
      data: [],
      errors: [{ message: "bad csv" }],
    });
    await expect(
      extractTextFromFile({
        buffer: Buffer.from("raw,csv"),
        mimeType: "text/csv",
        filename: "report.csv",
      })
    ).resolves.toBe("raw,csv");

    await expect(
      extractTextFromFile({
        buffer: Buffer.from("plain text"),
        mimeType: "text/plain",
        filename: "note.txt",
      })
    ).resolves.toBe("plain text");
  });

  test("checkModeration respects disable flag, custom blocklist, and defaults", () => {
    process.env.MODERATION_ENABLED = "0";
    expect(checkModeration("anything")).toEqual({ ok: true });

    process.env.MODERATION_ENABLED = "1";
    process.env.MODERATION_BLOCKLIST = "fraud, scam";
    expect(checkModeration("This is a scam")).toEqual({
      ok: false,
      reason: "Blocked keyword: scam",
    });

    delete process.env.MODERATION_BLOCKLIST;
    expect(checkModeration("обсуждение самоубийства")).toEqual({
      ok: false,
      reason: "Blocked keyword: самоубий",
    });
    expect(checkModeration("harmless text")).toEqual({ ok: true });
  });

  test("getStripe requires a secret key and caches the client", () => {
    expect(() => getStripe()).toThrow("STRIPE_SECRET_KEY is not set");

    const instance = { checkout: {} };
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    mocks.stripeCtor.mockImplementation(() => instance);

    expect(getStripe()).toBe(instance);
    expect(getStripe()).toBe(instance);
    expect(mocks.stripeCtor).toHaveBeenCalledTimes(1);
    expect(mocks.stripeCtor).toHaveBeenCalledWith("sk_test_123", {});
  });

  test("verifyTelegramLogin validates signature freshness and missing token", () => {
    const botToken = "telegram-bot-token";
    const payloadBase = {
      id: 42,
      auth_date: Math.floor(Date.now() / 1000),
      first_name: "Ada",
      username: "ada",
    };

    const secretKey = crypto.createHash("sha256").update(botToken).digest();
    const dataCheckString = Object.entries(payloadBase)
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");
    const hash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    expect(() =>
      verifyTelegramLogin({ ...payloadBase, hash }, "")
    ).toThrow("TELEGRAM_BOT_TOKEN is not set");

    expect(verifyTelegramLogin({ ...payloadBase, hash }, botToken)).toBe(true);
    expect(
      verifyTelegramLogin(
        { ...payloadBase, auth_date: payloadBase.auth_date - 60 * 60 * 25, hash },
        botToken
      )
    ).toBe(false);
    expect(verifyTelegramLogin({ ...payloadBase, hash: "bad" }, botToken)).toBe(false);
  });

  test("transcribeAudio validates env, download, transcription error, and success path", async () => {
    await expect(
      transcribeAudio({
        fileUrl: "https://example.com/audio.ogg",
      })
    ).rejects.toThrow("OPENAI_API_KEY is not set");

    process.env.OPENAI_API_KEY = "openai-key";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response);

    await expect(
      transcribeAudio({
        fileUrl: "https://example.com/audio.ogg",
      })
    ).rejects.toThrow("Failed to download audio file");

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("audio-bytes").buffer,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      } as Response);

    await expect(
      transcribeAudio({
        fileUrl: "https://example.com/audio.ogg",
      })
    ).rejects.toThrow("Whisper error: 429 rate limited");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("audio-bytes").buffer,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "transcribed text" }),
      } as Response);
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    await expect(
      transcribeAudio({
        fileUrl: "https://example.com/audio.ogg",
        fileName: "voice.ogg",
        mimeType: "audio/ogg",
        language: "en",
      })
    ).resolves.toBe("transcribed text");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.com/audio.ogg",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer openai-key" },
        body: expect.any(FormData),
      })
    );
  });
});
