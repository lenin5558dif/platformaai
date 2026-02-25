import { NextResponse } from "next/server";
import { fetchModels, filterFreeOpenRouterModels } from "@/lib/models";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrgModelPolicy } from "@/lib/org-settings";
import { filterModels } from "@/lib/model-policy";

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
    select: { balance: true, org: { select: { settings: true } } },
  });

  try {
    const modelPolicy = getOrgModelPolicy(user?.org?.settings ?? null);
    const data = await fetchModels();
    const filtered = filterModels(data, modelPolicy);
    const hasPaidAccess = Number(user?.balance ?? 0) > 0;
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
