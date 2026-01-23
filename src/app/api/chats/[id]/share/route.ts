import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chat = await prisma.chat.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, shareToken: true },
  });

  if (!chat) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const shareToken =
    chat.shareToken ?? randomBytes(16).toString("hex");

  if (!chat.shareToken) {
    await prisma.chat.update({
      where: { id },
      data: { shareToken },
    });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return NextResponse.json({
    data: {
      shareToken,
      url: `${baseUrl}/share/${shareToken}`,
    },
  });
}
