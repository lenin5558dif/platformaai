import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateScimRequest } from "@/lib/scim";
import { scimGroupResource } from "@/lib/scim-responses";
import { logAudit } from "@/lib/audit";

async function updateGroup(
  request: Request,
  context: { params: Promise<{ id: string }> },
  isPatch = false
) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const group = await prisma.costCenter.findFirst({
    where: { id, orgId: auth.orgId },
  });

  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = await request.json();
  const updates: { name?: string } = {};

  if (isPatch && Array.isArray(payload?.Operations)) {
    for (const op of payload.Operations) {
      const path = String(op.path ?? "").toLowerCase();
      if (path.includes("displayname") && typeof op.value === "string") {
        updates.name = op.value;
      }
      if (path.includes("members") && Array.isArray(op.value)) {
        const memberIds = op.value
          .map((member: { value?: string }) => member.value)
          .filter((value: unknown): value is string => typeof value === "string");
        if (memberIds.length) {
          await prisma.user.updateMany({
            where: { id: { in: memberIds }, orgId: auth.orgId },
            data: { costCenterId: group.id },
          });
        }
      }
      if (path.includes("members") && op.op === "remove") {
        const memberIds = Array.isArray(op.value)
          ? op.value
              .map((member: { value?: string }) => member.value)
              .filter((value: unknown): value is string => typeof value === "string")
          : [];
        if (memberIds.length) {
          await prisma.user.updateMany({
            where: { id: { in: memberIds }, orgId: auth.orgId },
            data: { costCenterId: null },
          });
        }
      }
    }
  } else {
    if (typeof payload?.displayName === "string") {
      updates.name = payload.displayName;
    }
    if (Array.isArray(payload?.members) && payload.members.length) {
      const memberIds = payload.members
        .map((member: { value?: string }) => member.value)
        .filter((value: unknown): value is string => typeof value === "string");
      if (memberIds.length) {
        await prisma.user.updateMany({
          where: { id: { in: memberIds }, orgId: auth.orgId },
          data: { costCenterId: group.id },
        });
      }
    }
  }

  const updated = Object.keys(updates).length
    ? await prisma.costCenter.update({
        where: { id: group.id },
        data: updates,
      })
    : group;

  await logAudit({
    action: "SCIM_GROUP_SYNC",
    orgId: auth.orgId,
    targetType: "cost_center",
    targetId: group.id,
    metadata: { updates },
  });

  return NextResponse.json(scimGroupResource(updated), {
    headers: { "Content-Type": "application/scim+json" },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const group = await prisma.costCenter.findFirst({
    where: { id, orgId: auth.orgId },
  });

  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(scimGroupResource(group), {
    headers: { "Content-Type": "application/scim+json" },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateGroup(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateGroup(request, context, true);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const group = await prisma.costCenter.findFirst({
    where: { id, orgId: auth.orgId },
  });

  if (!group) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.costCenter.delete({
    where: { id: group.id },
  });

  await logAudit({
    action: "SCIM_GROUP_SYNC",
    orgId: auth.orgId,
    targetType: "cost_center",
    targetId: group.id,
    metadata: { removed: true },
  });

  return new Response(null, { status: 204 });
}
