import { NextResponse } from "next/server";
import { fetchModels } from "@/lib/models";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUserOpenRouterKey } from "@/lib/user-settings";
import { getOrgModelPolicy } from "@/lib/org-settings";
import { filterModels } from "@/lib/model-policy";

export async function GET(request: Request) {
  const session = await auth(request);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowUserKey =
    process.env.AUTH_BYPASS === "1" ||
    process.env.ALLOW_USER_OPENROUTER_KEYS === "1";
  let apiKey: string | undefined;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true, org: { select: { settings: true } } },
  });

  if (allowUserKey) {
    apiKey = getUserOpenRouterKey(user?.settings ?? null);
  }

  try {
    const modelPolicy = getOrgModelPolicy(user?.org?.settings ?? null);
    const data = await fetchModels({ apiKey });
    const filtered = filterModels(data, modelPolicy);
    return NextResponse.json({ data: { data: filtered } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter error";
    const status = message.includes("OPENROUTER_API_KEY") ? 401 : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
