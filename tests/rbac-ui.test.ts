import { describe, expect, it } from "vitest";
import {
  RBAC_PERMISSION_GROUPS,
  hasPermission,
  mapRbacError,
  roleHasGroupPermission,
  type RbacRoleView,
} from "@/lib/rbac-ui";
import { ORG_PERMISSIONS } from "@/lib/org-permissions";

describe("rbac-ui helpers", () => {
  it("maps known errors to safe messages", () => {
    expect(mapRbacError("FORBIDDEN").tone).toBe("warning");
    expect(mapRbacError("LAST_OWNER").title).toContain("Owner");
    expect(mapRbacError("UNAUTHORIZED").tone).toBe("warning");
  });

  it("returns fallback for unknown errors", () => {
    const message = mapRbacError("SOMETHING_NEW");
    expect(message.tone).toBe("error");
    expect(message.message.length).toBeGreaterThan(0);
  });

  it("checks direct permission key presence", () => {
    const keys = [ORG_PERMISSIONS.ORG_INVITE_CREATE, ORG_PERMISSIONS.ORG_ANALYTICS_READ];
    expect(hasPermission(keys, ORG_PERMISSIONS.ORG_INVITE_CREATE)).toBe(true);
    expect(hasPermission(keys, ORG_PERMISSIONS.ORG_ROLE_CHANGE)).toBe(false);
  });

  it("checks grouped role permissions", () => {
    const role: RbacRoleView = {
      id: "role_1",
      name: "Manager",
      isSystem: true,
      permissionKeys: [ORG_PERMISSIONS.ORG_ANALYTICS_READ],
    };

    const analytics = RBAC_PERMISSION_GROUPS.find((group) => group.id === "analytics");
    const billing = RBAC_PERMISSION_GROUPS.find((group) => group.id === "billing");

    expect(analytics).toBeTruthy();
    expect(billing).toBeTruthy();
    expect(roleHasGroupPermission(role, analytics!)).toBe(true);
    expect(roleHasGroupPermission(role, billing!)).toBe(false);
  });
});
