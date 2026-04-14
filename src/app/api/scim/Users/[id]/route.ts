import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateScimRequest } from "@/lib/scim";
import { scimUserResource } from "@/lib/scim-responses";
import { logAudit } from "@/lib/audit";

type ScimGroupValue = { value?: unknown };
type ScimPayload = {
  userName?: unknown;
  emails?: Array<{ value?: unknown }>;
  active?: unknown;
  groups?: ScimGroupValue[];
  Operations?: Array<{ path?: unknown; value?: unknown; op?: unknown }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function extractEmail(payload: unknown) {
  if (!isRecord(payload)) return null;
  if (typeof payload.userName === "string") return payload.userName;
  if (Array.isArray(payload.emails)) {
    const first = payload.emails.find((entry) => isRecord(entry));
    if (first && typeof first.value === "string") {
      return first.value;
    }
  }
  return null;
}

function extractEmailFromValue(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isRecord(entry) && typeof entry.value === "string") {
        return entry.value;
      }
    }
  }
  return null;
}

async function applyGroups(userId: string, orgId: string, payload: unknown) {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload.groups)) return null;
  const first = payload.groups[0];
  const groupId =
    first && typeof first === "object" && "value" in first ? first.value : null;
  if (typeof groupId !== "string") {
    await prisma.user.update({
      where: { id: userId },
      data: { costCenterId: null },
    });
    return null;
  }

  const group = await prisma.costCenter.findFirst({
    where: { id: groupId, orgId },
  });
  if (!group) {
    return null;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { costCenterId: group.id },
  });

  return group;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const user = await prisma.user.findFirst({
    where: { id, orgId: auth.orgId },
    include: { costCenter: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(scimUserResource(user, user.costCenter ?? undefined), {
    headers: { "Content-Type": "application/scim+json" },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateUser(request, context);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateUser(request, context, true);
}

async function updateUser(
  request: Request,
  context: { params: Promise<{ id: string }> },
  isPatch = false
) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const user = await prisma.user.findFirst({
    where: { id, orgId: auth.orgId },
    include: { costCenter: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (await request.json()) as ScimPayload;
  const updates: { email?: string; isActive?: boolean } = {};

  if (isPatch && Array.isArray(payload?.Operations)) {
    for (const op of payload.Operations) {
      const path = String(op?.path ?? "").toLowerCase();
      const value = op?.value;
      if (path.includes("active")) {
        updates.isActive = Boolean(value);
      }
      if (path.includes("username") || path.includes("emails")) {
        const email = extractEmailFromValue(value);
        if (email) updates.email = email;
      }
      if (path.includes("groups")) {
        await applyGroups(user.id, auth.orgId, { groups: value });
      }
    }
  } else {
    const email = extractEmail(payload);
    if (email) updates.email = email;
    if (typeof payload?.active === "boolean") {
      updates.isActive = payload.active;
    }
    await applyGroups(user.id, auth.orgId, payload);
  }

  if (Object.keys(updates).length) {
    await prisma.user.update({
      where: { id: user.id },
      data: updates,
    });
  }

  const updated = await prisma.user.findFirst({
    where: { id: user.id, orgId: auth.orgId },
    include: { costCenter: true },
  });

  await logAudit({
    action: "SCIM_USER_SYNC",
    orgId: auth.orgId,
    targetType: "user",
    targetId: user.id,
    metadata: { updates },
  });

  return NextResponse.json(scimUserResource(updated!, updated?.costCenter ?? undefined), {
    headers: { "Content-Type": "application/scim+json" },
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await validateScimRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const user = await prisma.user.findFirst({
    where: { id, orgId: auth.orgId },
  });

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: false },
  });

  await logAudit({
    action: "SCIM_USER_SYNC",
    orgId: auth.orgId,
    targetType: "user",
    targetId: user.id,
    metadata: { active: false },
  });

  return new Response(null, { status: 204 });
}
