import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attachment = await prisma.attachment.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = await readFile(attachment.storagePath);

  return new NextResponse(file, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename="${attachment.filename}"`,
    },
  });
}
