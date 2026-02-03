import NextAuth from "next-auth";
import type { Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { EmailConfig, OIDCConfig } from "@auth/core/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { sendMagicLink } from "@/lib/unisender";
import { verifyTelegramLogin, type TelegramAuthPayload } from "@/lib/telegram";
import { z } from "zod";
import { Prisma, UserRole } from "@prisma/client";

const telegramSchema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

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

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    {
      id: "email",
      name: "Email",
      type: "email",
      from: process.env.UNISENDER_SENDER_EMAIL,
      maxAge: 10 * 60,
      sendVerificationRequest: async ({ identifier, url }) => {
        await sendMagicLink({ email: identifier, url });
      },
    } satisfies EmailConfig,
    CredentialsProvider({
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
    ...(ssoProvider ? [ssoProvider] : []),
  ],
  callbacks: {
    signIn: async ({ user, account, profile }) => {
      if (!user?.email) return true;
      if (!user?.id) return true;

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { isActive: true, orgId: true, role: true },
      });

      if (dbUser && dbUser.isActive === false) {
        return false;
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

        const emailVerifiedByProvider =
          account?.provider === "email"
            ? true
            : typeof (profile as any)?.email_verified === "boolean"
              ? Boolean((profile as any).email_verified)
              : null;

        await prisma.user.update({
          where: { id: user.id },
          data: { emailVerifiedByProvider },
        });
      }

      return true;
    },
    session: async ({ session, user }) => {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = user.role;
        session.user.orgId = user.orgId;
        session.user.balance = String(user.balance);
        session.user.emailVerified = (user as any).emailVerifiedByProvider ?? null;
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
      emailVerified: null,
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
    select: { isActive: true, orgId: true, role: true, emailVerifiedByProvider: true },
  });

  if (!dbUser) {
    return null;
  }

  if (dbUser.isActive === false) {
    return null;
  }

  session.user.orgId = dbUser.orgId;
  session.user.role = dbUser.role;
  (session.user as any).emailVerified = dbUser.emailVerifiedByProvider ?? null;

  return session;
}
