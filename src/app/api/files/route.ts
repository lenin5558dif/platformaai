import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extractTextFromFile } from "@/lib/file-parser";

const MAX_FILE_SIZE_MB = 10;

export async function POST(request: Request) {
  const session = await auth(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const chatId = String(formData.get("chatId") ?? "").trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не найден" }, { status: 400 });
  }

  const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return NextResponse.json(
      { error: `Файл больше ${MAX_FILE_SIZE_MB}MB` },
      { status: 400 }
    );
  }

  if (chatId) {
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, userId: session.user.id },
      select: { id: true },
    });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || "upload";
  const mimeType = file.type || "application/octet-stream";

  const isImage = mimeType.startsWith("image/");
  const textContent = isImage
    ? ""
    : await extractTextFromFile({ buffer, mimeType, filename });

  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageName = `${Date.now()}-${randomBytes(6).toString("hex")}-${safeName}`;
  const storagePath = path.join(uploadsDir, storageName);
  await writeFile(storagePath, buffer);

  const attachment = await prisma.attachment.create({
    data: {
      userId: session.user.id,
      chatId,
      filename,
      mimeType,
      size: file.size,
      storagePath,
      textContent: textContent.slice(0, 20000),
      metadata: isImage ? { kind: "image" } : { kind: "file" },
    },
  });

  return NextResponse.json({
    data: {
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      hasText: Boolean(attachment.textContent),
    },
  });
}
