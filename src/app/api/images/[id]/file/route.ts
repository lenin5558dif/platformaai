import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveGeneratedImageStoragePath } from "@/lib/image-storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const record = await prisma.imageGeneration.findFirst({
    where: {
      id,
      userId: session.user.id,
      status: "COMPLETED",
    },
    select: {
      id: true,
      mimeType: true,
      storagePath: true,
    },
  });

  if (!record?.storagePath || !record.mimeType) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const file = await readFile(resolveGeneratedImageStoragePath(record.storagePath));
    return new NextResponse(file, {
      headers: {
        "Content-Type": record.mimeType,
        "Content-Disposition": `inline; filename="${record.id}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
