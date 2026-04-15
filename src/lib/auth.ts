import NextAuth from "next-auth";
import type { Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { OIDCConfig } from "@auth/core/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { verifyTelegramLogin, type TelegramAuthPayload } from "@/lib/telegram";
import { consumeTelegramLoginToken } from "@/lib/telegram-login";
import { z } from "zod";
import { Prisma, UserRole } from "@prisma/client";
import { SYSTEM_ROLE_NAMES } from "@/lib/org-permissions";
import { ensureOrgSystemRolesAndPermissions } from "@/lib/org-rbac";
import { compare } from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

const telegramSchema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

const telegramLoginTokenSchema = z.object({
  loginToken: z.string().min(1).max(128),
});

const LOGIN_IP_LIMIT = 30;
const LOGIN_IP_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_IDENTITY_LIMIT = 10;
const LOGIN_IDENTITY_WINDOW_MS = 10 * 60 * 1000;

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
        allowDangerousEmailAccountLinking: false,
      }
    : null;

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const clientIp = getClientIp(request);

        const ipRate = await checkRateLimit({
          key: `auth:login:ip:${clientIp}`,
          limit: LOGIN_IP_LIMIT,
          windowMs: LOGIN_IP_WINDOW_MS,
        });
        if (!ipRate.ok) {
          return null;
        }

        const parsed = credentialsSchema.safeParse({
          email:
            typeof credentials?.email === "string"
              ? credentials.email.trim().toLowerCase()
              : "",
          password:
            typeof credentials?.password === "string" ? credentials.password : "",
        });

        if (!parsed.success) {
          return null;
        }

        const identityRate = await checkRateLimit({
          key: `auth:login:identity:${clientIp}:${parsed.data.email}`,
          limit: LOGIN_IDENTITY_LIMIT,
          windowMs: LOGIN_IDENTITY_WINDOW_MS,
        });
        if (!identityRate.ok) {
          return null;
        }

        const credentialsLookup = {
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            passwordHash: true,
            role: true,
            orgId: true,
            balance: true,
            isActive: true,
            emailVerifiedByProvider: true,
          },
        } as unknown as Parameters<typeof prisma.user.findUnique>[0];

        const user = (await prisma.user.findUnique(credentialsLookup)) as {
          id: string;
          email: string | null;
          passwordHash: string | null;
          role: UserRole;
          orgId: string | null;
          balance: Prisma.Decimal;
          isActive: boolean;
          emailVerifiedByProvider: boolean | null;
        } | null;

        if (!user || !user.passwordHash || user.isActive === false) {
          return null;
        }

        const isValid = await compare(parsed.data.password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email ?? undefined,
          role: user.role,
          orgId: user.orgId,
          balance: user.balance.toString(),
          emailVerifiedByProvider: user.emailVerifiedByProvider ?? null,
        };
      },
    }),
    CredentialsProvider({
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
        const user = await prisma.user.upsert({
          where: { telegramId },
          update: {},
          create: {
            telegramId,
            role: "USER",
          },
        });

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
    }),
    CredentialsProvider({
      id: "telegram-login",
      name: "Telegram App Login",
      credentials: {
        loginToken: { label: "Telegram login token", type: "text" },
      },
      authorize: async (credentials) => {
        const parsed = telegramLoginTokenSchema.safeParse({
          loginToken:
            typeof credentials?.loginToken === "string"
              ? credentials.loginToken.trim()
              : "",
        });

        if (!parsed.success) {
          return null;
        }

        const user = await consumeTelegramLoginToken({
          prisma,
          token: parsed.data.loginToken,
        });

        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email ?? undefined,
          role: user.role,
          orgId: user.orgId,
          balance: user.balance.toString(),
          emailVerifiedByProvider: user.emailVerifiedByProvider ?? null,
        };
      },
    }),
    ...(ssoProvider ? [ssoProvider] : []),
  ],
  callbacks: {
    signIn: async ({ user, account, profile }) => {
      if (!user?.id) return true;

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isActive: true, orgId: true, role: true },
      });

      if (dbUser && dbUser.isActive === false) {
        return false;
      }

      if (!user?.email) return true;

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

      if (usingSso) {
        const nextLegacyRole: UserRole = dbUser?.role === "ADMIN" ? "ADMIN" : "EMPLOYEE";

        if (dbUser?.orgId !== domainPolicy.orgId) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              orgId: domainPolicy.orgId,
              role: nextLegacyRole,
            },
          });
        }

        const { rolesByName } = await ensureOrgSystemRolesAndPermissions(domainPolicy.orgId);
        const roleName =
          nextLegacyRole === "ADMIN" ? SYSTEM_ROLE_NAMES.ADMIN : SYSTEM_ROLE_NAMES.MEMBER;
        const orgRole = rolesByName.get(roleName) ?? rolesByName.get(SYSTEM_ROLE_NAMES.MEMBER);
        if (orgRole) {
          await prisma.orgMembership.upsert({
            where: {
              orgId_userId: {
                orgId: domainPolicy.orgId,
                userId: user.id,
              },
            },
            update: { roleId: orgRole.id },
            create: {
              orgId: domainPolicy.orgId,
              userId: user.id,
              roleId: orgRole.id,
            },
          });
        }
      }

      if (account?.provider !== "telegram") {
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
      }

      if (
        account?.provider !== "telegram" &&
        account?.provider !== "credentials" &&
        account?.provider !== "telegram-login"
      ) {
        const profileRecord = profile as Record<string, unknown> | null;
        const profileEmailVerified =
          profileRecord && typeof profileRecord["email_verified"] === "boolean"
            ? (profileRecord["email_verified"] as boolean)
            : null;
        const emailVerifiedByProvider = profileEmailVerified;

        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedByProvider },
        });
      }

      return true;
    },
    jwt: async ({ token, user }) => {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.orgId = user.orgId;
        token.balance = String(user.balance);
        token.emailVerifiedByProvider = user.emailVerifiedByProvider ?? null;
        token.sessionIssuedAt = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session: async ({ session, user, token }) => {
      if (session.user) {
        const tokenSub = typeof token?.sub === "string" ? token.sub : null;
        const nextId = user?.id ?? tokenSub;
        if (nextId) {
          session.user.id = nextId;
        }

        const tokenRole =
          typeof token?.role === "string" &&
          (token.role === "USER" ||
            token.role === "ADMIN" ||
            token.role === "EMPLOYEE")
            ? token.role
            : null;
        session.user.role = user?.role ?? tokenRole ?? "USER";

        const tokenOrgId =
          typeof token?.orgId === "string" || token?.orgId === null
            ? token.orgId
            : null;
        session.user.orgId = user?.orgId ?? tokenOrgId ?? null;

        const tokenBalance =
          typeof token?.balance === "string" ? token.balance : null;
        session.user.balance = String(user?.balance ?? tokenBalance ?? "0");

        const tokenEmailVerified =
          typeof token?.emailVerifiedByProvider === "boolean" ||
          token?.emailVerifiedByProvider === null
            ? token.emailVerifiedByProvider
            : null;
        session.user.emailVerifiedByProvider =
          user?.emailVerifiedByProvider ?? tokenEmailVerified ?? null;

        const issuedAt =
          typeof token?.sessionIssuedAt === "number"
            ? token.sessionIssuedAt
            : typeof token?.iat === "number"
              ? token.iat
              : null;
        session.user.sessionTokenIssuedAt = issuedAt;
      }
      return session;
    },
  },
});

export const handlers = nextAuth.handlers;
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
    },
  };
}

export async function auth(request?: Request): Promise<Session | null> {
  const bypass = await getBypassSession();
  if (bypass) return bypass as Session;
  const session = request
    ? ((await nextAuthAuth(
        request as unknown as Parameters<typeof nextAuthAuth>[0]
      )) as unknown as Session | null)
    : ((await nextAuthAuth()) as unknown as Session | null);

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
    typeof session.user.sessionTokenIssuedAt === "number" &&
    session.user.sessionTokenIssuedAt * 1000 <= dbUser.sessionInvalidatedAt.getTime()
  ) {
    return null;
  }

  session.user.orgId = dbUser.orgId;
  session.user.role = dbUser.role;
  session.user.emailVerifiedByProvider =
    dbUser.emailVerifiedByProvider ?? null;

  return session;
}
