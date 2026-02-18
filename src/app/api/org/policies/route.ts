import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createAuthorizer, requireSession, toErrorResponse } from "@/lib/authorize";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";
import { getOrgDlpPolicy, getOrgModelPolicy, mergeOrgSettings } from "@/lib/org-settings";

const dlpSchema = z.object({
  type: z.literal("dlp"),
  enabled: z.boolean(),
  action: z.enum(["block", "redact"]),
  patterns: z.array(z.string()).default([]),
});

const modelSchema = z.object({
  type: z.literal("model"),
  mode: z.enum(["allowlist", "denylist"]),
  models: z.array(z.string()).default([]),
});

const patchSchema = z.union([dlpSchema, modelSchema]);

export async function GET() {
  try {
    const session = await requireSession();
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgMembership();

    const canRead =
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_POLICY_UPDATE) ||
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_AUDIT_READ) ||
      membership.permissionKeys.has(ORG_PERMISSIONS.ORG_ANALYTICS_READ);

    if (!canRead) {
      return NextResponse.json(
        { error: "Forbidden", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const org = await prisma.organization.findUnique({
      where: { id: membership.orgId },
      select: { settings: true },
    });

    return NextResponse.json({
      data: {
        dlpPolicy: getOrgDlpPolicy(org?.settings ?? null),
        modelPolicy: getOrgModelPolicy(org?.settings ?? null),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request);
    const authorizer = createAuthorizer(session);
    const membership = await authorizer.requireOrgPermission(ORG_PERMISSIONS.ORG_POLICY_UPDATE);

    const payload = patchSchema.parse(await request.json());
    const org = await prisma.organization.findUnique({
      where: { id: membership.orgId },
      select: { settings: true },
    });

    if (payload.type === "dlp") {
      const nextDlpPolicy = {
        enabled: payload.enabled,
        action: payload.action,
        patterns: payload.patterns.filter((entry) => entry.trim().length > 0),
      };

      await prisma.organization.update({
        where: { id: membership.orgId },
        data: {
          settings: mergeOrgSettings(org?.settings ?? null, {
            dlpPolicy: nextDlpPolicy,
          }),
        },
      });

      await logAudit({
        action: "DLP_POLICY_UPDATED",
        orgId: membership.orgId,
        actorId: session.user.id,
        targetType: "organization",
        targetId: membership.orgId,
        metadata: {
          enabled: nextDlpPolicy.enabled,
          action: nextDlpPolicy.action,
          patternsCount: nextDlpPolicy.patterns.length,
        },
      });

      return NextResponse.json({ data: { dlpPolicy: nextDlpPolicy } });
    }

    const nextModelPolicy = {
      mode: payload.mode,
      models: payload.models.filter((entry) => entry.trim().length > 0),
    };

    await prisma.organization.update({
      where: { id: membership.orgId },
      data: {
        settings: mergeOrgSettings(org?.settings ?? null, {
          modelPolicy: nextModelPolicy,
        }),
      },
    });

    await logAudit({
      action: "MODEL_POLICY_UPDATED",
      orgId: membership.orgId,
      actorId: session.user.id,
      targetType: "organization",
      targetId: membership.orgId,
      metadata: {
        mode: nextModelPolicy.mode,
        modelsCount: nextModelPolicy.models.length,
      },
    });

    return NextResponse.json({ data: { modelPolicy: nextModelPolicy } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
