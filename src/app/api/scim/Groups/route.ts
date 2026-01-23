import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateScimRequest } from "@/lib/scim";
import { scimGroupResource, scimListResponse } from "@/lib/scim-responses";
import { logAudit } from "@/lib/audit";

function parseFilter(filter: string | null) {
  if (!filter) return null;
  const nameMatch = filter.match(/displayName\s+eq\s+"(.+)"/i);
  if (nameMatch) {
    return { name: nameMatch[1] };
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

  const costCenters = await prisma.costCenter.findMany({
    where: { orgId: auth.orgId, ...(filter ?? {}) },
    orderBy: { name: "asc" },
  });

  const resources = costCenters.map((center) => scimGroupResource(center));

  return NextResponse.json(scimListResponse(resources, costCenters.length), {
    headers: { "Content-Type": "application/scim+json" },
  });
}

export async function POST(request: Request) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const displayName = String(payload?.displayName ?? "").trim();

  if (!displayName) {
    return NextResponse.json({ error: "Missing displayName" }, { status: 400 });
  }

  const costCenter = await prisma.costCenter.create({
    data: {
      orgId: auth.orgId,
      name: displayName,
    },
  });

  if (Array.isArray(payload?.members) && payload.members.length) {
    const memberIds = payload.members
      .map((member: { value?: string }) => member.value)
      .filter((value: unknown): value is string => typeof value === "string");

    if (memberIds.length) {
      await prisma.user.updateMany({
        where: { id: { in: memberIds }, orgId: auth.orgId },
        data: { costCenterId: costCenter.id },
      });
    }
  }

  await logAudit({
    action: "SCIM_GROUP_SYNC",
    orgId: auth.orgId,
    targetType: "cost_center",
    targetId: costCenter.id,
    metadata: { displayName },
  });

  return NextResponse.json(scimGroupResource(costCenter), {
    status: 201,
    headers: { "Content-Type": "application/scim+json" },
  });
}
