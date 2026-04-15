import { NextResponse } from "next/server";

export function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  headers.set("x-robots-tag", "noindex");

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

export function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return jsonNoStore({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    return jsonNoStore({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  return null;
}
