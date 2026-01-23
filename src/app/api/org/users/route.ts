import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["USER", "ADMIN", "EMPLOYEE"]).optional(),
});

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { orgId: true, role: true },
  });

  if (!user?.orgId) {
    return NextResponse.json({ data: [] });
  }

  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      role: true,
      balance: true,
      dailyLimit: true,
      monthlyLimit: true,
      isActive: true,
      costCenterId: true,
    },
  });

  const data = users.map((entry) => ({
    ...entry,
    balance: entry.balance.toString(),
    dailyLimit: entry.dailyLimit?.toString() ?? null,
    monthlyLimit: entry.monthlyLimit?.toString() ?? null,
  }));

  return NextResponse.json({ data });
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

  const payload = inviteSchema.parse(await request.json());
  const user = await prisma.user.upsert({
    where: { email: payload.email },
    update: { orgId: admin.orgId, role: payload.role ?? "EMPLOYEE" },
    create: {
      email: payload.email,
      orgId: admin.orgId,
      role: payload.role ?? "EMPLOYEE",
      balance: 0,
    },
  });

  await logAudit({
    action: "USER_INVITED",
    orgId: admin.orgId,
    actorId: session.user.id,
    targetType: "user",
    targetId: user.id,
    metadata: { email: user.email, role: user.role },
  });

  return NextResponse.json({ data: { id: user.id, email: user.email } }, { status: 201 });
}
