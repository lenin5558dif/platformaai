import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { refillController } from "./controller";

export async function POST(request: Request) {
  return refillController(request, { auth, prisma, logAudit });
}
