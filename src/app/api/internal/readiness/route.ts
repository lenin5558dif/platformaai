import { jsonNoStore } from "@/lib/internal-http";
import { getReadinessStatus } from "@/lib/internal-runtime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const status = await getReadinessStatus();
  return jsonNoStore(status, { status: status.status === "ready" ? 200 : 503 });
}
