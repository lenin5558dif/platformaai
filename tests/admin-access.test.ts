import { describe, expect, it } from "vitest";
import {
  getGlobalAdminEmails,
  isGlobalAdminEmail,
  isGlobalAdminSession,
  isGlobalAdminUser,
} from "@/lib/admin-access";

describe("admin-access", () => {
  it("parses normalized global admin emails", () => {
    expect(
      getGlobalAdminEmails({
        GLOBAL_ADMIN_EMAILS: " Admin@Example.com, ops@example.com , ",
      })
    ).toEqual(["admin@example.com", "ops@example.com"]);
  });

  it("matches sessions by email allowlist", () => {
    expect(
      isGlobalAdminSession(
        {
          user: {
            email: "Admin@Example.com",
          },
        },
        {
          GLOBAL_ADMIN_EMAILS: "admin@example.com",
        }
      )
    ).toBe(true);

    expect(
      isGlobalAdminSession(
        {
          user: {
            email: "member@example.com",
          },
        },
        {
          GLOBAL_ADMIN_EMAILS: "admin@example.com",
        }
      )
    ).toBe(false);

    expect(
      isGlobalAdminEmail("Admin@Example.com", {
        GLOBAL_ADMIN_EMAILS: "admin@example.com",
      })
    ).toBe(true);

    expect(
      isGlobalAdminUser(
        {
          email: "ops@example.com",
        },
        {
          GLOBAL_ADMIN_EMAILS: "ops@example.com",
        }
      )
    ).toBe(true);
  });
});
