import { PromptVisibility, UserRole } from "@prisma/client";

/**
 * Resolves the effective prompt visibility based on user permissions.
 *
 * ORG-scoped: Requires user to belong to an organization. No specific permission
 * check needed as membership implies ability to create org-visible prompts.
 *
 * GLOBAL-scoped: Platform-global operation. Only platform ADMIN users can create
 * globally visible prompts. This is intentionally NOT gated by org permissions
 * (ORG_PERMISSIONS) because it affects the entire platform, not a single org.
 * If enterprise RBAC needs to restrict this, it should be done at the platform
 * level (e.g., PLATFORM_PERMISSIONS) or by checking a specific platform role.
 */
export function resolvePromptVisibility(
  requestedVisibility: PromptVisibility,
  user: { role: UserRole; orgId: string | null } | null
): PromptVisibility {
  if (requestedVisibility === "ORG" && !user?.orgId) {
    return "PRIVATE";
  }

  // Platform-global operation: only platform ADMIN can set GLOBAL visibility
  if (requestedVisibility === "GLOBAL" && user?.role !== "ADMIN") {
    return "PRIVATE";
  }

  return requestedVisibility;
}
