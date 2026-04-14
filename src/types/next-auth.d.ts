import type { DefaultSession } from "next-auth";
import type { Prisma } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "USER" | "ADMIN" | "EMPLOYEE";
      orgId: string | null;
      balance: string;
      emailVerifiedByProvider?: boolean | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: "USER" | "ADMIN" | "EMPLOYEE";
    orgId: string | null;
    balance: Prisma.Decimal | string;
    emailVerifiedByProvider?: boolean | null;
  }
}
