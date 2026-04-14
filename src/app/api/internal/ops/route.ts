import { jsonNoStore, requireCronSecret } from "@/lib/internal-http";
import { getOpsStatus } from "@/lib/internal-runtime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const status = await getOpsStatus();
  return jsonNoStore(status, { status: status.status === "ready" ? 200 : 503 });
}
