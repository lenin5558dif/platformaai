import { NextResponse } from "next/server";
import { fetchModels, filterFreeOpenRouterModels } from "@/lib/models";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgModelPolicy } from "@/lib/org-settings";
import { filterModels } from "@/lib/model-policy";
import { getPlatformConfig } from "@/lib/platform-config";
import { resolveOpenRouterApiKey } from "@/lib/provider-credentials";
import { getUserOpenRouterKey } from "@/lib/user-settings";

export async function GET(request: Request) {
  const session = await auth(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowUserKey =
    process.env.AUTH_BYPASS === "1" ||
    process.env.ALLOW_USER_OPENROUTER_KEYS === "1";

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      settings: true,
      balance: true,
      orgId: true,
      org: { select: { settings: true } },
    },
  });

  try {
    const platformConfig = await getPlatformConfig();
    const userApiKey = allowUserKey ? getUserOpenRouterKey(user?.settings ?? null) : undefined;
    const fallbackApiKey = userApiKey
      ? undefined
      : await resolveOpenRouterApiKey({ orgId: user?.orgId ?? null });
    const openRouterApiKey = userApiKey ?? fallbackApiKey ?? undefined;

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
    const hasPaidAccess = user?.balance == null || Number(user.balance) > 0;
    const visibleModels = hasPaidAccess
      ? filtered
      : filterFreeOpenRouterModels(filtered);

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
    return NextResponse.json({ error: message }, { status });
  }
}
