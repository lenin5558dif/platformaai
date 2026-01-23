import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateScimToken, hashScimToken } from "@/lib/scim";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(2),
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, role: true },
  });

  if (!admin?.orgId || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tokens = await prisma.scimToken.findMany({
    where: { orgId: admin.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return NextResponse.json({
    data: tokens.map((token) => ({
      ...token,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, role: true },
  });

  if (!admin?.orgId || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = createSchema.parse(await request.json());
  const token = generateScimToken();
  const tokenPrefix = token.slice(0, 8);

  const record = await prisma.scimToken.create({
    data: {
      orgId: admin.orgId,
      name: payload.name,
      tokenHash: hashScimToken(token),
      tokenPrefix,
    },
  });

  await logAudit({
    action: "SCIM_TOKEN_CREATED",
    orgId: admin.orgId,
    actorId: session.user.id,
    targetType: "scim_token",
    targetId: record.id,
    metadata: { name: payload.name },
  });

  return NextResponse.json({
    data: {
      id: record.id,
      name: record.name,
      tokenPrefix: record.tokenPrefix,
      token,
    },
  });
}

export async function DELETE(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, role: true },
  });

  if (!admin?.orgId || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = deleteSchema.parse(await request.json());

  await prisma.scimToken.deleteMany({
    where: { id: payload.id, orgId: admin.orgId },
  });

  await logAudit({
    action: "SCIM_TOKEN_REVOKED",
    orgId: admin.orgId,
    actorId: session.user.id,
    targetType: "scim_token",
    targetId: payload.id,
  });

  return NextResponse.json({ ok: true });
}
