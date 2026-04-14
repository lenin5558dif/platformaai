import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  getRateLimitHeaders,
  getRetryAfterHeader,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { getSettingsObject } from "@/lib/user-settings";

const registerSchema = z
  .object({
    nickname: z.string().trim().min(2).max(40),
    email: z.string().trim().email(),
    password: z.string().min(8).max(72),
    confirmPassword: z.string().min(8).max(72),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match",
      });
    }
  });

const REGISTER_IP_LIMIT = 10;
const REGISTER_IP_WINDOW_MS = 10 * 60 * 1000;
const REGISTER_EMAIL_LIMIT = 5;
const REGISTER_EMAIL_WINDOW_MS = 60 * 60 * 1000;

function buildRegisterRateLimitedResponse(params: {
  limit: number;
  remaining: number;
  resetAt: number;
}) {
  return NextResponse.json(
    {
      error: "RATE_LIMITED",
      message: "Too many registration attempts. Please try again later.",
    },
    {
      status: 429,
      headers: {
        ...getRateLimitHeaders({
          limit: params.limit,
          remaining: params.remaining,
          resetAt: params.resetAt,
        }),
        ...getRetryAfterHeader(params.resetAt),
      },
    }
  );
}

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const ipRate = await checkRateLimit({
    key: `auth:register:ip:${clientIp}`,
    limit: REGISTER_IP_LIMIT,
    windowMs: REGISTER_IP_WINDOW_MS,
  });

  if (!ipRate.ok) {
    return buildRegisterRateLimitedResponse({
      limit: REGISTER_IP_LIMIT,
      remaining: ipRate.remaining,
      resetAt: ipRate.resetAt,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const parsed = registerSchema.safeParse(payload);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        message: firstIssue?.message ?? "Validation failed.",
      },
      { status: 400 }
    );
  }

  const nickname = parsed.data.nickname.trim();
  const email = parsed.data.email.trim().toLowerCase();
  const emailRate = await checkRateLimit({
    key: `auth:register:email:${email}`,
    limit: REGISTER_EMAIL_LIMIT,
    windowMs: REGISTER_EMAIL_WINDOW_MS,
  });

  if (!emailRate.ok) {
    return buildRegisterRateLimitedResponse({
      limit: REGISTER_EMAIL_LIMIT,
      remaining: emailRate.remaining,
      resetAt: emailRate.resetAt,
    });
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const createData = {
    email,
    passwordHash,
    isActive: true,
    role: "USER",
    emailVerifiedByProvider: null,
    settings: {
      profileFirstName: nickname,
      onboarded: false,
    },
  } as unknown as Prisma.UserCreateInput;

  try {
    const existingLookup = {
      where: { email },
      select: { id: true, passwordHash: true, settings: true },
    } as unknown as Parameters<typeof prisma.user.findUnique>[0];

    const existing = (await prisma.user.findUnique(existingLookup)) as {
      id: string;
      passwordHash: string | null;
      settings: Prisma.JsonValue;
    } | null;
    if (existing?.passwordHash) {
      return NextResponse.json(
        { error: "EMAIL_ALREADY_EXISTS", message: "User with this email already exists." },
        { status: 409 }
      );
    }

    const existingSettings = existing ? getSettingsObject(existing.settings ?? null) : {};

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            isActive: true,
            emailVerifiedByProvider: null,
            settings: {
              ...existingSettings,
              profileFirstName: existingSettings.profileFirstName ?? nickname,
              onboarded: false,
            },
          } as unknown as Prisma.UserUpdateInput,
          select: {
            id: true,
            email: true,
          },
        })
      : await prisma.user.create({
          data: createData,
          select: {
            id: true,
            email: true,
          },
        });

    await prisma.userChannel.upsert({
      where: {
        userId_channel: {
          userId: user.id,
          channel: "WEB",
        },
      },
      update: { externalId: user.id },
      create: {
        userId: user.id,
        channel: "WEB",
        externalId: user.id,
      },
    });

    return NextResponse.json(
      {
        data: {
          id: user.id,
          email: user.email,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        {
          error: "DB_UNAVAILABLE",
          message: "Database is unavailable. Check DATABASE_URL and PostgreSQL status.",
        },
        { status: 503 }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "EMAIL_ALREADY_EXISTS", message: "User with this email already exists." },
        { status: 409 }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2022"
    ) {
      return NextResponse.json(
        {
          error: "DB_SCHEMA_OUTDATED",
          message:
            "Database schema is outdated. Run Prisma migrations (passwordHash column is missing).",
        },
        { status: 500 }
      );
    }
    const fallbackMessage =
      error instanceof Error ? error.message : "Unexpected error during registration.";
    return NextResponse.json(
      { error: "REGISTER_FAILED", message: fallbackMessage },
      { status: 500 }
    );
  }
}
