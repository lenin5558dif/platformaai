import { beforeEach, describe, expect, test, vi } from "vitest";

const logAudit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/audit", () => ({ logAudit }));

describe("setUserAdminRoleByAdmin", () => {
  const state = {
    user: {
      id: "user_1",
      email: "user@example.com",
      role: "USER",
      orgId: "org_1",
    } as {
      id: string;
      email: string | null;
      role: "USER" | "ADMIN";
      orgId: string | null;
    } | null,
  };

  const prisma = {
    user: {
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async ({ data }: { data: { role: "USER" | "ADMIN" } }) => ({
        ...state.user,
        role: data.role,
      })),
    },
  } as any;

  beforeEach(() => {
    state.user = {
      id: "user_1",
      email: "user@example.com",
      role: "USER",
      orgId: "org_1",
    };
    vi.clearAllMocks();
  });

  test("promotes user to admin and writes audit", async () => {
    const { setUserAdminRoleByAdmin } = await import("../src/lib/admin-user-role");

    const result = await setUserAdminRoleByAdmin({
      prisma,
      actorId: "admin_1",
      userId: "user_1",
      nextRole: "ADMIN",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { role: "ADMIN" },
      select: {
        id: true,
        email: true,
        role: true,
        orgId: true,
      },
    });
    expect(result).toMatchObject({ id: "user_1", role: "ADMIN" });
    expect(logAudit).toHaveBeenCalledWith({
      action: "USER_UPDATED",
      orgId: "org_1",
      actorId: "admin_1",
      targetType: "user",
      targetId: "user_1",
      metadata: {
        adminSection: "clients",
        roleChanged: true,
        previousRole: "USER",
        nextRole: "ADMIN",
        email: "user@example.com",
      },
    });
  });

  test("rejects self demotion from admin", async () => {
    state.user = {
      id: "admin_1",
      email: "admin@example.com",
      role: "ADMIN",
      orgId: "org_1",
    };
    const { setUserAdminRoleByAdmin } = await import("../src/lib/admin-user-role");

    await expect(
      setUserAdminRoleByAdmin({
        prisma,
        actorId: "admin_1",
        userId: "admin_1",
        nextRole: "USER",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "CANNOT_DEMOTE_SELF",
    });
  });

  test("returns current user when role is unchanged", async () => {
    state.user = {
      id: "admin_2",
      email: "admin2@example.com",
      role: "ADMIN",
      orgId: "org_1",
    };
    const { setUserAdminRoleByAdmin } = await import("../src/lib/admin-user-role");

    const result = await setUserAdminRoleByAdmin({
      prisma,
      actorId: "admin_1",
      userId: "admin_2",
      nextRole: "ADMIN",
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: "admin_2", role: "ADMIN" });
  });
});
