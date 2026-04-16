import { NextResponse } from "next/server";
import { fetchModels, filterFreeOpenRouterModels } from "@/lib/models";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgModelPolicy } from "@/lib/org-settings";
import { filterModels } from "@/lib/model-policy";
import { getPlatformConfig } from "@/lib/platform-config";
import { resolveOpenRouterApiKey } from "@/lib/provider-credentials";
import { getBillingTier, isFreeBillingTier } from "@/lib/billing-tiers";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      balance: true,
      orgId: true,
      settings: true,
      org: { select: { settings: true } },
    },
  });
  const billingTier = getBillingTier(user?.settings ?? null, user?.balance);

  try {
    const [platformConfig, openRouterApiKey] = await Promise.all([
      getPlatformConfig(),
      resolveOpenRouterApiKey({ userId: user?.id ?? null, orgId: user?.orgId ?? null }),
    ]);
    if (!openRouterApiKey) {
      return NextResponse.json(
        { error: "OPENROUTER_API_KEY is not set", code: "OPENROUTER_KEY_MISSING" },
        { status: 401 }
      );
    }

    const modelPolicy = getOrgModelPolicy(user?.org?.settings ?? null);
    const data = await fetchModels({ apiKey: openRouterApiKey });
    const disabledModels = new Set(
      platformConfig.disabledModelIds
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
    );
    const filtered = filterModels(data, modelPolicy).filter(
      (model) => !disabledModels.has(model.id.trim().toLowerCase())
    );
    const visibleModels = isFreeBillingTier(billingTier)
      ? filterFreeOpenRouterModels(filtered)
      : filtered;

    return NextResponse.json({ data: { data: visibleModels } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter error";
    const lower = message.toLowerCase();
    const isMissingKey = message.includes("OPENROUTER_API_KEY");
    const isInvalidKey =
      (lower.includes("unauthorized") ||
        lower.includes("invalid") ||
        lower.includes("no auth credentials")) &&
      lower.includes("openrouter");
    const status = isMissingKey || isInvalidKey ? 401 : 500;
    const code = isMissingKey
      ? "OPENROUTER_KEY_MISSING"
      : isInvalidKey
        ? "OPENROUTER_KEY_INVALID"
        : "OPENROUTER_ERROR";
    return NextResponse.json(
      { error: message, code },
      { status }
    );
  }
}
