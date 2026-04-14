import { metricsRegistry } from "@/lib/metrics";
import { requireCronSecret } from "@/lib/internal-http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  return new Response(metricsRegistry.renderPrometheus(), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      "x-robots-tag": "noindex",
    },
  });
}
