import { NextResponse } from "next/server";
import { hashPasswordResetToken } from "@/lib/admin-password-reset";
import { prisma } from "@/lib/db";

function maskEmail(email: string | null) {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0] ?? "*"}*@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();

  if (!token) {
    return NextResponse.json({ valid: false, reason: "TOKEN_MISSING" }, { status: 400 });
  }

  const tokenHash = hashPasswordResetToken(token);
  const record = await prisma.adminPasswordResetToken.findFirst({
    where: { tokenHash },
    include: {
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!record) {
    return NextResponse.json({ valid: false, reason: "TOKEN_INVALID" }, { status: 404 });
  }

  if (record.usedAt) {
    return NextResponse.json({ valid: false, reason: "TOKEN_USED" }, { status: 410 });
  }

  if (record.expiresAt <= new Date()) {
    return NextResponse.json({ valid: false, reason: "TOKEN_EXPIRED" }, { status: 410 });
  }

  return NextResponse.json({
    valid: true,
    email: maskEmail(record.user.email),
    expiresAt: record.expiresAt.toISOString(),
  });
}
