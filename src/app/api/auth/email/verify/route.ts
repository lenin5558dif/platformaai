import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { consumeEmailVerificationToken } from "@/lib/email-verification";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const session = await auth();
  const settingsUrl = `${appUrl}/settings`;
  const loginUrl = `${appUrl}/login?mode=signin`;
  const targetBase = session?.user?.id ? settingsUrl : loginUrl;
  const joinQuery = (value: string) =>
    `${targetBase}${targetBase.includes("?") ? "&" : "?"}${value}`;

  if (!token) {
    return NextResponse.redirect(joinQuery("verification=invalid"));
  }

  const result = await consumeEmailVerificationToken(token);

  if (!result.ok) {
    const target =
      result.reason === "TOKEN_EXPIRED"
        ? joinQuery("verification=expired")
        : joinQuery("verification=invalid");
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(joinQuery("verification=verified"));
}
