import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  records: [] as Array<Record<string, unknown>>,
  record: null as null | Record<string, unknown>,
  file: Buffer.from("image"),
  readFileError: null as null | Error,
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.authenticated ? { user: { id: "user_1" } } : null)),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    imageGeneration: {
      findMany: state.findMany,
      findFirst: state.findFirst,
    },
  },
}));

vi.mock("@/lib/image-storage", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/image-storage")>(
    "../src/lib/image-storage"
  );
  return {
    ...actual,
    hasGeneratedImageFile: vi.fn((storagePath: string | null | undefined) =>
      Boolean(storagePath && storagePath !== "/tmp/missing.png")
    ),
    resolveGeneratedImageStoragePath: vi.fn((storagePath: string) => storagePath),
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => {
    if (state.readFileError) throw state.readFileError;
    return state.file;
  }),
}));

function generation(overrides: Record<string, unknown> = {}) {
  return {
    id: "gen_1",
    prompt: "Нарисуй город",
    revisedPrompt: null,
    modelId: "image/free",
    status: "COMPLETED",
    mimeType: "image/png",
    storagePath: "/tmp/gen_1.png",
    publicUrl: null,
    width: null,
    height: null,
    aspectRatio: "1:1",
    imageSize: "1K",
    cost: { toString: () => "0" },
    tokenCount: 0,
    providerRequestId: null,
    error: null,
    chatId: null,
    messageId: null,
    createdAt: new Date("2026-04-23T09:00:00.000Z"),
    updatedAt: new Date("2026-04-23T09:00:00.000Z"),
    ...overrides,
  };
}

describe("api images gallery routes", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.records = [generation()];
    state.record = generation({ storagePath: "/tmp/gen_1.png" });
    state.file = Buffer.from("image");
    state.readFileError = null;
    state.findMany.mockReset().mockResolvedValue(state.records);
    state.findFirst.mockReset().mockResolvedValue(state.record);
  });

  test("lists only current user's image generations", async () => {
    const { GET } = await import("../src/app/api/images/route");

    const res = await GET(new Request("http://localhost/api/images?limit=99&status=COMPLETED"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(state.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        status: "COMPLETED",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(json.data[0]).toMatchObject({
      id: "gen_1",
      cost: "0",
      fileUrl: "/api/images/gen_1/file",
    });
  });

  test("does not expose broken gallery files as available", async () => {
    state.records = [generation({ storagePath: "/tmp/missing.png" })];
    state.findMany.mockResolvedValueOnce(state.records);
    const { GET } = await import("../src/app/api/images/route");

    const res = await GET(new Request("http://localhost/api/images"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data[0]).toMatchObject({
      id: "gen_1",
      fileUrl: null,
    });
  });

  test("returns image details with ownership check", async () => {
    const { GET } = await import("../src/app/api/images/[id]/route");

    const res = await GET(new Request("http://localhost/api/images/gen_1"), {
      params: Promise.resolve({ id: "gen_1" }),
    });

    expect(res.status).toBe(200);
    expect(state.findFirst).toHaveBeenCalledWith({
      where: { id: "gen_1", userId: "user_1" },
    });
    expect(await res.json()).toMatchObject({
      data: {
        id: "gen_1",
        fileUrl: "/api/images/gen_1/file",
      },
    });
  });

  test("returns 404 for missing image details", async () => {
    state.findFirst.mockResolvedValueOnce(null);
    const { GET } = await import("../src/app/api/images/[id]/route");

    const res = await GET(new Request("http://localhost/api/images/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(res.status).toBe(404);
  });

  test("serves generated image files only for owner and completed records", async () => {
    const { GET } = await import("../src/app/api/images/[id]/file/route");

    const res = await GET(new Request("http://localhost/api/images/gen_1/file"), {
      params: Promise.resolve({ id: "gen_1" }),
    });

    expect(res.status).toBe(200);
    expect(state.findFirst).toHaveBeenCalledWith({
      where: {
        id: "gen_1",
        userId: "user_1",
        status: "COMPLETED",
      },
      select: {
        id: true,
        mimeType: true,
        storagePath: true,
      },
    });
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("image");
  });

  test("returns 401 when gallery session is missing", async () => {
    state.authenticated = false;
    const { GET } = await import("../src/app/api/images/route");

    const res = await GET(new Request("http://localhost/api/images"));

    expect(res.status).toBe(401);
  });
});
