import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  title: z.string().min(2),
  content: z.string().min(10),
  scope: z.enum(["ORG", "GLOBAL"]).optional(),
  visibility: z.enum(["PRIVATE", "ORG", "GLOBAL"]).optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true },
  });

  const orConditions: Prisma.PromptWhereInput[] = [
    { visibility: "GLOBAL" as const },
    { visibility: "PRIVATE" as const, createdById: session.user.id },
  ];

  if (user?.orgId) {
    orConditions.push({ visibility: "ORG" as const, orgId: user.orgId });
  }

  const prompts = await prisma.prompt.findMany({
    where: { OR: orConditions },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: prompts });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = createSchema.parse(await request.json());
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true },
  });

  const requestedVisibility =
    payload.visibility ??
    (payload.scope === "GLOBAL" ? "GLOBAL" : "ORG");

  const visibility =
    requestedVisibility === "ORG" && !user?.orgId
      ? "PRIVATE"
      : requestedVisibility;

  const tags =
    payload.tags
      ?.map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 10) ?? [];

  const orgId = visibility === "ORG" ? user?.orgId ?? null : null;

  const prompt = await prisma.prompt.create({
    data: {
      title: payload.title,
      content: payload.content,
      orgId,
      visibility,
      tags: Array.from(new Set(tags)),
      createdById: session.user.id,
    },
  });

  return NextResponse.json({ data: prompt }, { status: 201 });
}
