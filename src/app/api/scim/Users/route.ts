import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateScimRequest } from "@/lib/scim";
import { scimListResponse, scimUserResource } from "@/lib/scim-responses";
import { logAudit } from "@/lib/audit";

function parseFilter(filter: string | null) {
  if (!filter) return null;
  const userNameMatch = filter.match(/userName\s+eq\s+"(.+)"/i);
  if (userNameMatch) {
    return { email: userNameMatch[1] };
  }
  const idMatch = filter.match(/id\s+eq\s+"(.+)"/i);
  if (idMatch) {
    return { id: idMatch[1] };
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filter = parseFilter(searchParams.get("filter"));
  const startIndex = Number(searchParams.get("startIndex") ?? "1");
  const count = Number(searchParams.get("count") ?? "100");
  const skip = Math.max(0, startIndex - 1);
  const take = Math.min(Math.max(count, 1), 200);

  const where = {
    orgId: auth.orgId,
    ...(filter ?? {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { costCenter: true },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  const resources = users.map((user) =>
    scimUserResource(user, user.costCenter ?? undefined)
  );

  return NextResponse.json(scimListResponse(resources, total), {
    headers: { "Content-Type": "application/scim+json" },
  });
}

export async function POST(request: Request) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const email =
    typeof payload?.userName === "string"
      ? payload.userName
      : payload?.emails?.[0]?.value;

  if (!email) {
    return NextResponse.json({ error: "Missing userName" }, { status: 400 });
  }

  const active = payload?.active !== false;

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      orgId: auth.orgId,
      isActive: active,
      role: "EMPLOYEE",
    },
    create: {
      email,
      orgId: auth.orgId,
      isActive: active,
      role: "EMPLOYEE",
      balance: 0,
    },
  });

  let costCenter = null;
  const groupId = payload?.groups?.[0]?.value;
  if (typeof groupId === "string") {
    const group = await prisma.costCenter.findFirst({
      where: { id: groupId, orgId: auth.orgId },
    });
    if (group) {
      await prisma.user.update({
        where: { id: user.id },
        data: { costCenterId: group.id },
      });
      costCenter = group;
    }
  }

  await logAudit({
    action: "SCIM_USER_SYNC",
    orgId: auth.orgId,
    targetType: "user",
    targetId: user.id,
    metadata: { email, active },
  });

  return NextResponse.json(scimUserResource({ ...user, isActive: active }, costCenter), {
    status: 201,
    headers: { "Content-Type": "application/scim+json" },
  });
}
