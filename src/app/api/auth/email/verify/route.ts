import { NextResponse } from "next/server";
import { consumeEmailVerificationToken } from "@/lib/email-verification";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";

  if (!token) {
    return NextResponse.redirect(`${appUrl}/settings?verification=invalid`);
  }

  const result = await consumeEmailVerificationToken(token);

  if (!result.ok) {
    const target =
      result.reason === "TOKEN_EXPIRED"
        ? `${appUrl}/settings?verification=expired`
        : `${appUrl}/settings?verification=invalid`;
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(`${appUrl}/settings?verification=verified`);
}
