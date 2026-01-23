import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const update = await request.json();

  return NextResponse.json({ ok: true, update });
}
