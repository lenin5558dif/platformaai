import { NextResponse } from "next/server";
import { consumeEmailVerificationToken } from "@/lib/email-verification";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const loginUrl = `${appUrl}/login?mode=signin`;

  if (!token) {
    return NextResponse.redirect(`${loginUrl}&verification=invalid`);
  }

  const result = await consumeEmailVerificationToken(token);

  if (!result.ok) {
    const target =
      result.reason === "TOKEN_EXPIRED"
        ? `${loginUrl}&verification=expired`
        : `${loginUrl}&verification=invalid`;
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(`${loginUrl}&verification=verified`);
}
