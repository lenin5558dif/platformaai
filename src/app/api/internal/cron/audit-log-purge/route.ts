import { NextResponse } from "next/server";
import { runAuditLogPurgeJob } from "@/lib/audit-log-purge-job";

function unauthorized() {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return unauthorized();

  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== expected) return unauthorized();

  const res = await runAuditLogPurgeJob({ signal: req.signal });
  return NextResponse.json(res);
}
