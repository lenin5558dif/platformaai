import { beforeEach, describe, expect, test, vi } from "vitest";

const logAudit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/audit", () => ({ logAudit }));

function createTx() {
  return {
    auditLog: { updateMany: vi.fn(async () => ({ count: 1 })) },
    orgInvite: { updateMany: vi.fn(async () => ({ count: 0 })) },
    dlpPolicy: { updateMany: vi.fn(async () => ({ count: 0 })) },
    modelPolicy: { updateMany: vi.fn(async () => ({ count: 0 })) },
    orgProviderCredential: { updateMany: vi.fn(async () => ({ count: 0 })) },
    platformConfig: { updateMany: vi.fn(async () => ({ count: 0 })) },
    adminPasswordResetToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    feedback: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    attachment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    message: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    chat: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    transaction: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    telegramLinkToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    userChannel: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    account: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    session: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    prompt: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    verificationToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    orgMembership: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    user: { delete: vi.fn(async () => ({ id: "user_1" })) },
  };
}

describe("deleteUserByAdmin", () => {
  const state = {
    user: {
      id: "user_1",
      email: "user@example.com",
      telegramId: "12345",
      orgId: "org_1",
    } as {
      id: string;
      email: string | null;
      telegramId: string | null;
      orgId: string | null;
    } | null,
    ownedOrg: null as { id: string } | null,
  };

  const tx = createTx();
  const prisma = {
    user: {
      findUnique: vi.fn(async () => state.user),
    },
    organization: {
      findFirst: vi.fn(async () => state.ownedOrg),
    },
    $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
  } as any;

  beforeEach(() => {
    state.user = {
      id: "user_1",
      email: "user@example.com",
      telegramId: "12345",
      orgId: "org_1",
    };
    state.ownedOrg = null;
    vi.clearAllMocks();
  });

  test("rejects self delete", async () => {
    const { deleteUserByAdmin } = await import("../src/lib/admin-user-delete");

    await expect(
      deleteUserByAdmin({
        prisma,
        actorId: "user_1",
        userId: "user_1",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "CANNOT_DELETE_SELF",
    });
  });

  test("rejects deleting organization owner", async () => {
    state.ownedOrg = { id: "org_owned" };
    const { deleteUserByAdmin } = await import("../src/lib/admin-user-delete");

    await expect(
      deleteUserByAdmin({
        prisma,
        actorId: "admin_1",
        userId: "user_1",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "ORG_OWNER_DELETE_FORBIDDEN",
    });
  });

  test("deletes dependent records and writes audit entry", async () => {
    const { deleteUserByAdmin } = await import("../src/lib/admin-user-delete");

    const result = await deleteUserByAdmin({
      prisma,
      actorId: "admin_1",
      userId: "user_1",
    });

    expect(result).toMatchObject({
      id: "user_1",
      email: "user@example.com",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.attachment.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: "user_1" }, { chat: { userId: "user_1" } }],
      },
    });
    expect(tx.message.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: "user_1" }, { chat: { userId: "user_1" } }],
      },
    });
    expect(tx.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: {
        identifier: { startsWith: "email-verify:user_1:" },
      },
    });
    expect(tx.user.delete).toHaveBeenCalledWith({
      where: { id: "user_1" },
    });
    expect(logAudit).toHaveBeenCalledWith({
      action: "USER_DISABLED",
      orgId: "org_1",
      actorId: "admin_1",
      targetType: "user",
      targetId: "user_1",
      metadata: {
        adminSection: "clients",
        deleted: true,
        email: "user@example.com",
        telegramId: "12345",
      },
    });
  });
});
