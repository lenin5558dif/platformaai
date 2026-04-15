import "@/lib/env";

import NextAuth from "next-auth";
import type { Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { EmailConfig, OIDCConfig } from "@auth/core/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { EmailSignInError } from "@auth/core/errors";
import { compare } from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuditAction, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { sendMagicLink } from "@/lib/unisender";
import { verifyTelegramLogin, type TelegramAuthPayload } from "@/lib/telegram";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getTelegramAuthConfig } from "@/lib/telegram-auth-config";
import {
  evaluateAuthEmailGuardrails,
  loadAuthEmailGuardrails,
} from "@/lib/auth-ui";
import { z } from "zod";

const telegramSchema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

const authEmailGuardrails = loadAuthEmailGuardrails();
const EMAIL_SIGNIN_DOMAIN_LIMIT = 20;
const EMAIL_SIGNIN_DOMAIN_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_SIGNIN_SUSPICIOUS_DOMAIN_LIMIT = 5;
const emailAuthConfigured =
  Boolean(process.env.UNISENDER_API_KEY) &&
  Boolean(process.env.UNISENDER_SENDER_EMAIL);
const telegramAuthConfigured = getTelegramAuthConfig().enabled;

async function logAuthSecurityAudit(params: {
  stage: "email_signin" | "invite_create" | "invite_resend" | "invite_accept";
  reason: string;
  email: string;
  domain: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  blocked?: boolean;
  suspicious?: boolean;
}) {
  await logAudit({
    action: AuditAction.POLICY_BLOCKED,
    ip: params.clientIp ?? undefined,
    userAgent: params.userAgent ?? undefined,
    metadata: {
      auth: {
        stage: params.stage,
        reason: params.reason,
        email: params.email,
        domain: params.domain,
        blocked: params.blocked ?? false,
        suspicious: params.suspicious ?? false,
      },
    },
  });
}

const ssoProvider: OIDCConfig<Record<string, unknown>> | null =
  process.env.SSO_ISSUER &&
  process.env.SSO_CLIENT_ID &&
  process.env.SSO_CLIENT_SECRET
    ? {
        id: "sso",
        name: process.env.SSO_NAME ?? "SSO",
        type: "oidc",
        issuer: process.env.SSO_ISSUER,
        clientId: process.env.SSO_CLIENT_ID,
        clientSecret: process.env.SSO_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }
    : null;

const emailProvider: EmailConfig | null = emailAuthConfigured
  ? ({
      id: "email",
      name: "Email",
      type: "email",
      from: process.env.UNISENDER_SENDER_EMAIL,
      maxAge: 10 * 60,
      sendVerificationRequest: async ({ identifier, url }) => {
        const normalizedEmail = identifier.trim().toLowerCase();
        const authDecision = evaluateAuthEmailGuardrails(
          normalizedEmail,
          authEmailGuardrails
        );
        const requestHeaders = await headers();
        const clientIp = getClientIp(requestHeaders);
        const userAgent = requestHeaders.get("user-agent");

        if (authDecision.blocked) {
          await logAuthSecurityAudit({
            stage: "email_signin",
            reason: "blocked_email_domain",
            email: authDecision.normalizedEmail,
            domain: authDecision.domain,
            clientIp,
            userAgent,
            blocked: true,
          });

          throw new EmailSignInError("Unable to send verification email");
        }

        if (authDecision.domain) {
          const domainRateLimit = await checkRateLimit({
            key: `auth:email-domain:${authDecision.domain}`,
            limit: authDecision.suspicious
              ? EMAIL_SIGNIN_SUSPICIOUS_DOMAIN_LIMIT
              : EMAIL_SIGNIN_DOMAIN_LIMIT,
            windowMs: EMAIL_SIGNIN_DOMAIN_WINDOW_MS,
          });

          if (!domainRateLimit.ok) {
            await logAuthSecurityAudit({
              stage: "email_signin",
              reason: authDecision.suspicious
                ? "suspicious_domain_throttled"
                : "domain_throttled",
              email: authDecision.normalizedEmail,
              domain: authDecision.domain,
              clientIp,
              userAgent,
              blocked: true,
              suspicious: authDecision.suspicious,
            });

            throw new EmailSignInError("Rate limited");
          }
        }

        try {
          await sendMagicLink({ email: normalizedEmail, url });
        } catch {
          throw new EmailSignInError("Unable to send verification email");
        }
      },
    } satisfies EmailConfig)
  : null;

const tempAccessProvider =
  process.env.TEMP_ACCESS_TOKEN && process.env.NEXT_PUBLIC_TEMP_ACCESS_ENABLED === "1"
    ? CredentialsProvider({
        id: "temp-access",
        name: "Temporary access",
        credentials: {
          token: { label: "Access token", type: "password" },
        },
        authorize: async (credentials) => {
          const token =
            typeof credentials?.token === "string" ? credentials.token.trim() : "";

          if (!token || token !== process.env.TEMP_ACCESS_TOKEN) {
            return null;
          }

          const user = await prisma.user.upsert({
            where: {
              email:
                process.env.TEMP_ACCESS_EMAIL?.trim().toLowerCase() ??
                "temp-access@platforma.local",
            },
            update: {
              role: (process.env.TEMP_ACCESS_ROLE as UserRole | undefined) ?? "ADMIN",
              isActive: true,
            },
            create: {
              email:
                process.env.TEMP_ACCESS_EMAIL?.trim().toLowerCase() ??
                "temp-access@platforma.local",
              role: (process.env.TEMP_ACCESS_ROLE as UserRole | undefined) ?? "ADMIN",
              isActive: true,
            },
          });

          return {
            id: user.id,
            email: user.email ?? undefined,
            name: "Temporary Access",
            role: user.role,
            orgId: user.orgId,
            balance: user.balance.toString(),
          };
        },
      })
    : null;

const passwordProvider = CredentialsProvider({
  id: "credentials",
  name: "Email and Password",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  authorize: async (credentials) => {
    const email =
      typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
    const password =
      typeof credentials?.password === "string" ? credentials.password : "";

    if (!email || !password) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        orgId: true,
        balance: true,
        passwordHash: true,
        isActive: true,
        emailVerifiedByProvider: true,
      },
    });

    if (!user?.passwordHash) {
      return null;
    }

    const passwordMatches = await compare(password, user.passwordHash).catch(() => false);
    if (!passwordMatches) {
      return null;
    }

    return {
      id: user.id,
      email: user.email ?? undefined,
      name: user.email ?? "User",
      role: user.role,
      orgId: user.orgId,
      balance: user.balance.toString(),
      emailVerifiedByProvider: user.emailVerifiedByProvider,
    };
  },
});

const telegramProvider = telegramAuthConfigured
  ? CredentialsProvider({
      id: "telegram",
      name: "Telegram",
      credentials: {
        data: { label: "Telegram payload", type: "text" },
      },
      authorize: async (credentials) => {
        if (!credentials?.data) {
          return null;
        }

        const raw =
          typeof credentials.data === "string" ? credentials.data : null;
        if (!raw) {
          return null;
        }

        let parsed: TelegramAuthPayload;
        try {
          parsed = telegramSchema.parse(JSON.parse(raw));
        } catch {
          return null;
        }

        const isValid = verifyTelegramLogin(
          parsed,
          process.env.TELEGRAM_BOT_TOKEN ?? ""
        );

        if (!isValid) {
          return null;
        }

        const telegramId = String(parsed.id);
        const user = await prisma.user.findUnique({
          where: { telegramId },
          select: {
            id: true,
            email: true,
            role: true,
            orgId: true,
            balance: true,
          },
        });

        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email ?? undefined,
          name:
            parsed.first_name ||
            parsed.username ||
            "Telegram User",
          image: parsed.photo_url,
          role: user.role,
          orgId: user.orgId,
          balance: user.balance.toString(),
        };
      },
    })
  : null;

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [
    ...(emailProvider ? [emailProvider] : []),
    passwordProvider,
    ...(telegramProvider ? [telegramProvider] : []),
    ...(tempAccessProvider ? [tempAccessProvider] : []),
    ...(ssoProvider ? [ssoProvider] : []),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = user.role;
        token.orgId = user.orgId;
        token.balance =
          typeof user.balance === "string"
            ? user.balance
            : user.balance.toString();
        token.emailVerifiedByProvider =
          user.emailVerifiedByProvider ?? null;
        token.sessionIssuedAt = Date.now();
      }

      return token;
    },
    signIn: async ({ user, account, email, profile }) => {
      if (
        account?.provider === "email" &&
        email?.verificationRequest &&
        user?.email
      ) {
        const clientIp = getClientIp(await headers());
        const rate = await checkRateLimit({
          key: `auth:email:${user.email.trim().toLowerCase()}`,
          limit: 5,
          windowMs: 15 * 60 * 1000,
        });

        const ipRate = await checkRateLimit({
          key: `auth:email-ip:${clientIp}`,
          limit: 20,
          windowMs: 15 * 60 * 1000,
        });

        if (!rate.ok || !ipRate.ok) {
          throw new EmailSignInError("Rate limited");
        }
      }

      if (!user?.email) return true;
      if (!user?.id) return true;

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isActive: true, orgId: true, role: true },
      });

      if (dbUser && dbUser.isActive === false) {
        return "/login?error=AccountDisabled";
      }

      const domain = user.email.split("@")[1]?.toLowerCase();
      if (!domain) return true;

      const domainPolicy = await prisma.orgDomain.findUnique({
        where: { domain },
        select: { orgId: true, ssoOnly: true },
      });

      if (!domainPolicy) return true;

      const usingSso = account?.provider === "sso";
      if (domainPolicy.ssoOnly && !usingSso) {
        return "/login?error=SSORequired";
      }

      if (usingSso && dbUser?.orgId !== domainPolicy.orgId) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            orgId: domainPolicy.orgId,
            role: dbUser?.role === "ADMIN" ? "ADMIN" : "EMPLOYEE",
          },
        });
      }

      if (account?.type !== "credentials") {
        await prisma.userChannel.upsert({
          where: {
            userId_channel: {
              userId: user.id,
              channel: "WEB",
            },
          },
          update: {
            externalId: user.id,
          },
          create: {
            userId: user.id,
            channel: "WEB",
            externalId: user.id,
          },
        });

        const profileRecord = profile as Record<string, unknown> | null;
        const profileEmailVerified =
          profileRecord && typeof profileRecord["email_verified"] === "boolean"
            ? (profileRecord["email_verified"] as boolean)
            : null;
        const emailVerifiedByProvider =
          account?.provider === "email" ? true : profileEmailVerified;

        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedByProvider },
        });
      }

      return true;
    },
    session: async ({ session, user, token }) => {
      const safeToken = token ?? {};
      const tokenRole =
        typeof safeToken.role === "string" ? (safeToken.role as UserRole) : undefined;
      const tokenOrgId =
        typeof safeToken.orgId === "string" ? safeToken.orgId : null;
      const tokenBalance =
        typeof safeToken.balance === "string" ? safeToken.balance : undefined;
      const tokenEmailVerifiedByProvider =
        typeof safeToken.emailVerifiedByProvider === "boolean"
          ? safeToken.emailVerifiedByProvider
          : null;
      const tokenSessionIssuedAt =
        typeof safeToken.sessionIssuedAt === "number" ? safeToken.sessionIssuedAt : null;
      const balance =
        typeof user?.balance === "string"
          ? user.balance
          : user?.balance?.toString?.() ?? tokenBalance ?? "0";
      const userId =
        user?.id ??
        (typeof safeToken.sub === "string" && safeToken.sub.length > 0
          ? safeToken.sub
          : "");

      if (session.user) {
        session.user.id = userId;
        session.user.role = user?.role ?? tokenRole ?? session.user.role ?? "USER";
        session.user.orgId = user?.orgId ?? tokenOrgId ?? session.user.orgId ?? null;
        session.user.balance = balance;
        session.user.emailVerifiedByProvider =
          user?.emailVerifiedByProvider ??
          tokenEmailVerifiedByProvider ??
          null;
        session.user.sessionTokenIssuedAt = tokenSessionIssuedAt;
      }
      return session;
    },
  },
});

export const handlers = nextAuth.handlers;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;

const nextAuthAuth = nextAuth.auth;

async function getBypassSession() {
  if (process.env.AUTH_BYPASS !== "1") {
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    console.error("[SECURITY] AUTH_BYPASS is enabled in production! Ignoring.");
    return null;
  }

  const email = process.env.AUTH_BYPASS_EMAIL ?? "dev@platforma.local";
  const role = (process.env.AUTH_BYPASS_ROLE ?? "ADMIN") as UserRole;
  const balance = new Prisma.Decimal(
    process.env.AUTH_BYPASS_BALANCE ?? "1000"
  );

  const user = await prisma.user.upsert({
    where: { email },
    update: { role, balance, isActive: true },
    create: {
      email,
      role,
      balance,
      isActive: true,
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      balance: user.balance.toString(),
      emailVerifiedByProvider: null,
      sessionTokenIssuedAt: Date.now(),
    },
  };
}

export async function auth(request?: Request): Promise<Session | null> {
  const bypass = await getBypassSession();
  if (bypass) return bypass as Session;
  let session = request
    ? ((await nextAuthAuth(
        request as unknown as Parameters<typeof nextAuthAuth>[0]
      )) as unknown as Session | null)
    : ((await nextAuthAuth()) as unknown as Session | null);

  if (!session?.user?.id && request) {
    session = (await nextAuthAuth()) as unknown as Session | null;
  }

  if (!session?.user?.id) {
    return session;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      isActive: true,
      orgId: true,
      role: true,
      emailVerifiedByProvider: true,
      sessionInvalidatedAt: true,
    },
  });

  if (!dbUser) {
    return null;
  }

  if (dbUser.isActive === false) {
    return null;
  }

  if (
    dbUser.sessionInvalidatedAt &&
    session.user.sessionTokenIssuedAt &&
    dbUser.sessionInvalidatedAt.getTime() >
      session.user.sessionTokenIssuedAt
  ) {
    return null;
  }

  session.user.orgId = dbUser.orgId;
  session.user.role = dbUser.role;
  session.user.emailVerifiedByProvider =
    dbUser.emailVerifiedByProvider ?? null;

  return session;
}

export async function requirePageSession(): Promise<Session> {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login?mode=signin");
  }

  return session;
}
