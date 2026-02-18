import { NextResponse } from "next/server";
import { metricsRegistry } from "@/lib/metrics";

function unauthorized() {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return unauthorized();

  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== expected) return unauthorized();

  return new Response(metricsRegistry.renderPrometheus(), {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4" },
  });
}
