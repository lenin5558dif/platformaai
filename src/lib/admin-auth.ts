import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http-error";

export async function requireAdminActor() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      role: true,
      email: true,
      orgId: true,
    },
  });

  if (!user || user.role !== "ADMIN") {
    throw new HttpError(403, "FORBIDDEN", "Admin access required");
  }

  return user;
}
