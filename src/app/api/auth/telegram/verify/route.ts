import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated endpoint",
      code: "DEPRECATED_ENDPOINT",
      replacement: {
        createLink: "/api/telegram/token (POST)",
        checkStatus: "/api/telegram/token?token=<token> (GET)",
      },
    },
    { status: 410 }
  );
}
