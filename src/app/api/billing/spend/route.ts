import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated endpoint",
      code: "DEPRECATED_ENDPOINT",
      message:
        "Public balance spending is handled by /api/ai/chat and /api/ai/image after server-side usage accounting.",
    },
    { status: 410 }
  );
}
