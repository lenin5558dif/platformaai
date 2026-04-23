import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBillingTier, isFreeBillingTier } from "@/lib/billing-tiers";
import { prisma } from "@/lib/db";
import { fetchImageModels, filterFreeImageModels } from "@/lib/image-models";
import { filterModels } from "@/lib/model-policy";
import { getOrgModelPolicy } from "@/lib/org-settings";
import { getPlatformConfig } from "@/lib/platform-config";
import { resolveOpenRouterApiKey } from "@/lib/provider-credentials";

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
    const disabledModels = new Set(
      platformConfig.disabledModelIds
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    );
    const billingTier = getBillingTier(user?.settings ?? null, user?.balance);
    const models = await fetchImageModels({ apiKey: openRouterApiKey });
    const policyFiltered = filterModels(models, modelPolicy).filter(
      (model) => !disabledModels.has(model.id.trim().toLowerCase())
    );
    const visibleModels = isFreeBillingTier(billingTier)
      ? filterFreeImageModels(policyFiltered)
      : policyFiltered;

    return NextResponse.json({ data: visibleModels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter image models error";
    const isMissingKey = message.includes("OPENROUTER_API_KEY");
    return NextResponse.json(
      {
        error: message,
        code: isMissingKey ? "OPENROUTER_KEY_MISSING" : "OPENROUTER_ERROR",
      },
      { status: isMissingKey ? 401 : 500 }
    );
  }
}
