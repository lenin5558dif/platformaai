import { jsonNoStore } from "@/lib/internal-http";
import { getHealthStatus } from "@/lib/internal-runtime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return jsonNoStore(getHealthStatus());
}
