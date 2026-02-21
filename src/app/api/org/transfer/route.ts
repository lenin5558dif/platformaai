import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json(
    {
      error: "Deprecated endpoint",
      code: "DEPRECATED_ENDPOINT",
      message:
        "Use the organization management UI transfer flow in /org (server action transferCredits).",
    },
    { status: 410 }
  );
}
