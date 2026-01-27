import { PromptVisibility, UserRole } from "@prisma/client";

export function resolvePromptVisibility(
  requestedVisibility: PromptVisibility,
  user: { role: UserRole; orgId: string | null } | null
): PromptVisibility {
  if (requestedVisibility === "ORG" && !user?.orgId) {
    return "PRIVATE";
  }

  if (requestedVisibility === "GLOBAL" && user?.role !== "ADMIN") {
    return "PRIVATE";
  }

  return requestedVisibility;
}
