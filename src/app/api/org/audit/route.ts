import { NextResponse } from "next/server";
import { AuditAction, Prisma } from "@prisma/client";
import { z } from "zod";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { prisma } from "@/lib/db";

const querySchema = z.object({
  actor: z.string().trim().optional(),
  action: z.string().trim().optional(),
  channel: z.enum(["WEB", "TELEGRAM", "SCIM", "API"]).optional(),
  period: z.enum(["24h", "7d", "30d"]).optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
});

function periodToDate(period?: "24h" | "7d" | "30d") {
  if (!period) return null;
  const now = Date.now();
  if (period === "24h") return new Date(now - 24 * 60 * 60 * 1000);
  if (period === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  return new Date(now - 30 * 24 * 60 * 60 * 1000);
}

function sanitizeMetadata(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeMetadata);
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      const lower = key.toLowerCase();
      if (
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("password") ||
        lower.includes("hash")
      ) {
        return [key, "[redacted]"];
      }
      return [key, sanitizeMetadata(val)];
    });
    return Object.fromEntries(entries);
  }

  return value;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_AUDIT_READ);

    const url = new URL(request.url);
    const parsed = querySchema.parse({
      actor: url.searchParams.get("actor") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      channel: (url.searchParams.get("channel") ?? undefined) as
        | "WEB"
        | "TELEGRAM"
        | "SCIM"
        | "API"
        | undefined,
      period: (url.searchParams.get("period") ?? undefined) as
        | "24h"
        | "7d"
        | "30d"
        | undefined,
      limit: url.searchParams.get("limit") ?? 50,
    });

    const where: Prisma.AuditLogWhereInput = {
      orgId: membership.orgId,
    };

    if (parsed.actor) {
      where.OR = [
        { actorId: { contains: parsed.actor, mode: "insensitive" } },
        { actor: { email: { contains: parsed.actor, mode: "insensitive" } } },
      ];
    }

    if (parsed.action) {
      if (!(Object.values(AuditAction) as string[]).includes(parsed.action)) {
        return NextResponse.json(
          {
            error: "Invalid action filter",
            code: "INVALID_INPUT",
          },
          { status: 400 }
        );
      }
      where.action = parsed.action as Prisma.AuditLogWhereInput["action"];
    }

    if (parsed.channel) {
      where.channel = parsed.channel as Prisma.AuditLogWhereInput["channel"];
    }

    const from = periodToDate(parsed.period);
    if (from) {
      where.createdAt = { gte: from };
    }

    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: parsed.limit,
      select: {
        id: true,
        createdAt: true,
        action: true,
        channel: true,
        actorId: true,
        targetType: true,
        targetId: true,
        metadata: true,
        correlationId: true,
        actor: { select: { email: true } },
      },
    });

    return NextResponse.json({
      data: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        channel: row.channel,
        actorId: row.actorId,
        actorEmail: row.actor?.email ?? null,
        targetType: row.targetType,
        targetId: row.targetId,
        correlationId: row.correlationId,
        metadata: sanitizeMetadata(row.metadata),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
