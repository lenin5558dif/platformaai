import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateScimToken, hashScimToken } from "@/lib/scim";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

const createSchema = z.object({
  name: z.string().min(2),
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

export async function GET() {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_SCIM_MANAGE
    );

  const tokens = await prisma.scimToken.findMany({
    where: { orgId: membership.orgId },
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
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_SCIM_MANAGE
    );

  const payload = createSchema.parse(await request.json());
  const token = generateScimToken();
  const tokenPrefix = token.slice(0, 8);

  const record = await prisma.scimToken.create({
    data: {
      orgId: membership.orgId,
      name: payload.name,
      tokenHash: hashScimToken(token),
      tokenPrefix,
    },
  });

  await logAudit({
    action: "SCIM_TOKEN_CREATED",
    orgId: membership.orgId,
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
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(
      ORG_PERMISSIONS.ORG_SCIM_MANAGE
    );

  const payload = deleteSchema.parse(await request.json());

  await prisma.scimToken.deleteMany({
    where: { id: payload.id, orgId: membership.orgId },
  });

  await logAudit({
    action: "SCIM_TOKEN_REVOKED",
    orgId: membership.orgId,
    actorId: session.user.id,
    targetType: "scim_token",
    targetId: payload.id,
  });

  return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
