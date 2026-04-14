import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { refillController } from "./controller";

export async function POST(request: Request) {
  return refillController(request, { prisma, logAudit });
}
