import { runAuditLogPurgeJob } from "@/lib/audit-log-purge-job";
import { requireCronSecret, jsonNoStore } from "@/lib/internal-http";

export async function POST(req: Request) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const res = await runAuditLogPurgeJob({ signal: req.signal });
  return jsonNoStore(res);
}
