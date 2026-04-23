import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ImageStorageError,
  parseImageDataUrl,
  saveGeneratedImageDataUrl,
} from "../src/lib/image-storage";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("image storage", () => {
  test("parses a supported image data url", () => {
    const result = parseImageDataUrl("data:image/png;base64,aGVsbG8=");

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer.toString("utf8")).toBe("hello");
  });

  test("rejects unsupported mime types", () => {
    expect(() => parseImageDataUrl("data:image/svg+xml;base64,PHN2Zy8+")).toThrow(
      ImageStorageError
    );
  });

  test("stores generated image under a sanitized user directory", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "image-storage-"));

    const result = await saveGeneratedImageDataUrl({
      dataUrl: "data:image/webp;base64,aW1hZ2U=",
      userId: "../user:1",
      generationId: "gen:1",
      baseDir: tempDir,
    });

    expect(result).toMatchObject({
      filename: "gen_1.webp",
      mimeType: "image/webp",
      size: 5,
    });
    expect(result.storagePath).toBe(path.join("___user_1", "gen_1.webp"));
    await expect(readFile(result.absoluteStoragePath, "utf8")).resolves.toBe("image");
  });

  test("rejects images over the configured size limit", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "image-storage-"));

    await expect(
      saveGeneratedImageDataUrl({
        dataUrl: "data:image/png;base64,aGVsbG8=",
        userId: "user_1",
        baseDir: tempDir,
        maxBytes: 2,
      })
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });
});
