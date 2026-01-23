import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const EVENT_TYPES = [
  "AI_REQUEST",
  "AI_ERROR",
  "BILLING_ERROR",
  "STT_ERROR",
  "AUTH_ERROR",
] as const;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function escapeCsv(value: string) {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const model = url.searchParams.get("model") ?? "";
  const limit = clampNumber(
    Number(url.searchParams.get("limit") ?? 200),
    10,
    1000
  );

  const selectedType = EVENT_TYPES.includes(type as (typeof EVENT_TYPES)[number])
    ? (type as (typeof EVENT_TYPES)[number])
    : "";
  const selectedModel = model.trim();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, orgId: true },
  });

  let userIds: string[] | null = null;

  if (user?.role === "ADMIN" && user.orgId) {
    const members = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: { id: true },
    });
    userIds = members.map((member) => member.id);
  }

  const events = await prisma.eventLog.findMany({
    where: {
      userId: userIds ? { in: userIds } : session.user.id,
      type: selectedType ? selectedType : undefined,
      modelId: selectedModel ? selectedModel : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const header = [
    "id",
    "createdAt",
    "type",
    "userId",
    "chatId",
    "modelId",
    "message",
    "payload",
  ];

  const rows = events.map((event) => {
    const payload = event.payload ? JSON.stringify(event.payload) : "";
    return [
      event.id,
      event.createdAt.toISOString(),
      event.type,
      event.userId ?? "",
      event.chatId ?? "",
      event.modelId ?? "",
      event.message ?? "",
      payload,
    ].map((value) => escapeCsv(String(value)));
  });

  const csv = [
    header.map(escapeCsv).join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=events.csv",
    },
  });
}
