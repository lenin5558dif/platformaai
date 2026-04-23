import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export class ImageStorageError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function parseImageDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new ImageStorageError("INVALID_DATA_URL", "Generated image is not a valid base64 data URL");
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new ImageStorageError("UNSUPPORTED_IMAGE_TYPE", "Generated image type is not supported");
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length === 0) {
    throw new ImageStorageError("EMPTY_IMAGE", "Generated image is empty");
  }

  return { mimeType, buffer };
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/png":
    default:
      return "png";
  }
}

export async function saveGeneratedImageDataUrl(params: {
  dataUrl: string;
  userId: string;
  generationId?: string;
  baseDir?: string;
  maxBytes?: number;
}) {
  const { mimeType, buffer } = parseImageDataUrl(params.dataUrl);
  const maxBytes = params.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (buffer.length > maxBytes) {
    throw new ImageStorageError("IMAGE_TOO_LARGE", "Generated image is too large");
  }

  const safeUserId = params.userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const generationSegment =
    params.generationId?.replace(/[^a-zA-Z0-9_-]/g, "_") ??
    `${Date.now()}-${randomBytes(6).toString("hex")}`;
  const baseDir =
    params.baseDir ??
    process.env.IMAGE_GENERATION_STORAGE_DIR ??
    path.join(process.cwd(), "generated-images");
  const userDir = path.join(baseDir, safeUserId);
  await mkdir(userDir, { recursive: true });

  const filename = `${generationSegment}.${extensionForMimeType(mimeType)}`;
  const storagePath = path.join(userDir, filename);
  await writeFile(storagePath, buffer);

  return {
    filename,
    storagePath,
    mimeType,
    size: buffer.length,
  };
}
