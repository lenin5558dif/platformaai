import { ImageGenerationStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializeImageGeneration } from "@/lib/image-generation-records";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 24;

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseStatus(value: string | null) {
  if (!value) return undefined;
  return Object.values(ImageGenerationStatus).includes(value as ImageGenerationStatus)
    ? (value as ImageGenerationStatus)
    : undefined;
}

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = parseLimit(searchParams.get("limit"));
  const status = parseStatus(searchParams.get("status"));

  const records = await prisma.imageGeneration.findMany({
    where: {
      userId: session.user.id,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const visibleRecords = records
    .map(serializeImageGeneration)
    .filter((record) => record.fileUrl !== null || record.status !== "COMPLETED");

  return NextResponse.json({
    data: visibleRecords,
  });
}
