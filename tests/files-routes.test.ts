import assert from "node:assert/strict";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  randomBytes: vi.fn(() => Buffer.from("010203040506", "hex")),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  extractTextFromFile: vi.fn(),
  prisma: {
    chat: {
      findFirst: vi.fn(),
    },
    attachment: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/file-parser", () => ({
  extractTextFromFile: mocks.extractTextFromFile,
}));

vi.mock("node:crypto", () => ({
  randomBytes: mocks.randomBytes,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  readFile: mocks.readFile,
}));

import { GET as getFile, POST as uploadFile } from "@/app/api/files/route";
import { GET as getAttachment } from "@/app/api/files/[id]/route";

function jsonResponse(res: Response) {
  return res.json() as Promise<any>;
}

describe("files routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(Buffer.from("downloaded file"));
    mocks.extractTextFromFile.mockResolvedValue("text from file");
    mocks.prisma.chat.findFirst.mockResolvedValue({ id: "chat-1" });
    mocks.prisma.attachment.create.mockResolvedValue({
      id: "att-1",
      filename: "report 1.txt",
      mimeType: "text/plain",
      size: 12,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      textContent: "stored text",
    });
    mocks.prisma.attachment.findFirst.mockResolvedValue({
      id: "att-1",
      storagePath: "/tmp/uploads/att-1",
      mimeType: "text/plain",
      filename: "report 1.txt",
    });
  });

  describe("POST /api/files", () => {
    test("returns 401 when the session is missing", async () => {
      mocks.auth.mockResolvedValueOnce(null);

      const formData = new FormData();
      formData.append("file", new File(["hello"], "report.txt", { type: "text/plain" }));

      const response = await uploadFile(
        new Request("http://localhost/api/files", {
          method: "POST",
          body: formData,
        })
      );

      assert.equal(response.status, 401);
      assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
    });

    test("returns 400 when file field is missing", async () => {
      const formData = new FormData();

      const response = await uploadFile(
        new Request("http://localhost/api/files", {
          method: "POST",
          body: formData,
        })
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await jsonResponse(response), { error: "Файл не найден" });
    });

    test("returns 400 when the file is larger than the limit", async () => {
      const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.bin", {
        type: "application/octet-stream",
      });
      const formData = new FormData();
      formData.append("file", file);

      const response = await uploadFile(
        new Request("http://localhost/api/files", {
          method: "POST",
          body: formData,
        })
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await jsonResponse(response), { error: "Файл больше 10MB" });
    });

    test("returns 404 when the requested chat does not belong to the user", async () => {
      mocks.prisma.chat.findFirst.mockResolvedValueOnce(null);
      const formData = new FormData();
      formData.append("file", new File(["hello"], "report.txt", { type: "text/plain" }));
      formData.append("chatId", "chat-2");

      const response = await uploadFile(
        new Request("http://localhost/api/files", {
          method: "POST",
          body: formData,
        })
      );

      assert.equal(response.status, 404);
      assert.deepEqual(await jsonResponse(response), { error: "Chat not found" });
      expect(mocks.extractTextFromFile).not.toHaveBeenCalled();
      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    test("stores text files after extracting text and truncating it", async () => {
      const extractedText = "x".repeat(21050);
      mocks.extractTextFromFile.mockResolvedValueOnce(extractedText);
      mocks.prisma.attachment.create.mockResolvedValueOnce({
        id: "att-1",
        filename: "report 1.txt",
        mimeType: "text/plain",
        size: 11,
        createdAt: new Date("2026-04-14T00:00:00.000Z"),
        textContent: "x".repeat(20000),
      });
      const file = new File(["hello world"], "report 1.txt", { type: "text/plain" });
      const formData = new FormData();
      formData.append("file", file);
      formData.append("chatId", "chat-1");

      const response = await uploadFile(
        new Request("http://localhost/api/files", {
          method: "POST",
          body: formData,
        })
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          id: "att-1",
          filename: "report 1.txt",
          mimeType: "text/plain",
          size: 11,
          createdAt: "2026-04-14T00:00:00.000Z",
          hasText: true,
        },
      });
      expect(mocks.extractTextFromFile).toHaveBeenCalledWith({
        buffer: expect.any(Buffer),
        mimeType: "text/plain",
        filename: "report 1.txt",
      });
      expect(mocks.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\/uploads\/\d+-010203040506-report_1\.txt$/),
        expect.any(Buffer)
      );
      expect(mocks.prisma.attachment.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          chatId: "chat-1",
          filename: "report 1.txt",
          mimeType: "text/plain",
          size: 11,
          storagePath: expect.stringMatching(/\/uploads\/\d+-010203040506-report_1\.txt$/),
          textContent: "x".repeat(20000),
          metadata: { kind: "file" },
        },
      });
    });

    test("stores image files without extracting text", async () => {
      mocks.prisma.attachment.create.mockResolvedValueOnce({
        id: "att-2",
        filename: "photo.png",
        mimeType: "image/png",
        size: 3,
        createdAt: new Date("2026-04-14T00:00:00.000Z"),
        textContent: "",
      });
      const file = new File([new Uint8Array([1, 2, 3])], "photo.png", {
        type: "image/png",
      });
      const formData = new FormData();
      formData.append("file", file);

      const response = await uploadFile(
        new Request("http://localhost/api/files", {
          method: "POST",
          body: formData,
        })
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await jsonResponse(response), {
        data: {
          id: "att-2",
          filename: "photo.png",
          mimeType: "image/png",
          size: 3,
          createdAt: "2026-04-14T00:00:00.000Z",
          hasText: false,
        },
      });
      expect(mocks.extractTextFromFile).not.toHaveBeenCalled();
      expect(mocks.prisma.attachment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          chatId: null,
          filename: "photo.png",
          mimeType: "image/png",
          size: 3,
          textContent: "",
          metadata: { kind: "image" },
        }),
      });
    });
  });

  describe("GET /api/files/[id]", () => {
    test("returns 401 when the session is missing", async () => {
      mocks.auth.mockResolvedValueOnce(null);

      const response = await getAttachment(
        new Request("http://localhost/api/files/att-1"),
        { params: Promise.resolve({ id: "att-1" }) }
      );

      assert.equal(response.status, 401);
      assert.deepEqual(await jsonResponse(response), { error: "Unauthorized" });
    });

    test("returns 404 when the attachment is not found", async () => {
      mocks.prisma.attachment.findFirst.mockResolvedValueOnce(null);

      const response = await getAttachment(
        new Request("http://localhost/api/files/att-1"),
        { params: Promise.resolve({ id: "att-1" }) }
      );

      assert.equal(response.status, 404);
      assert.deepEqual(await jsonResponse(response), { error: "Not found" });
      expect(mocks.readFile).not.toHaveBeenCalled();
    });

    test("streams the attachment with download headers", async () => {
      const response = await getAttachment(
        new Request("http://localhost/api/files/att-1"),
        { params: Promise.resolve({ id: "att-1" }) }
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/plain");
      assert.equal(
        response.headers.get("content-disposition"),
        'inline; filename="report 1.txt"'
      );
      assert.deepEqual(
        new Uint8Array(await response.arrayBuffer()),
        new Uint8Array(Buffer.from("downloaded file"))
      );
      expect(mocks.readFile).toHaveBeenCalledWith("/tmp/uploads/att-1");
    });
  });
});
