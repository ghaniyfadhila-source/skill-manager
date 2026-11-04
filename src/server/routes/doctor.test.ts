import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMP_PREFIX } from "../../fs/atomic.js";
import {
  createTestServer,
  jsonRequest,
  ok,
  seedSkill,
  storePath,
  type TestServer,
} from "./fixture.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface DriftEntryView {
  status: string;
  storeId: string;
  path: string;
  skillName?: string;
}

interface DoctorView {
  missing: DriftEntryView[];
  unmanaged: DriftEntryView[];
  tempDirs: string[];
  stale: DriftEntryView[];
}

async function installTo(server: TestServer, targets: readonly string[]): Promise<void> {
  await seedSkill(server.fs);
  const response = await jsonRequest(server, "/api/installations", "POST", {
    skill: "brainstorming",
    targets,
    acknowledgeShared: true,
  });
  expect(response.status).toBe(200);
}

async function doctor(server: TestServer): Promise<DoctorView> {
  const response = await server.request("/api/doctor");
  expect(response.status).toBe(200);
  return (await response.json()) as DoctorView;
}

describe("GET /api/doctor", () => {
  it("melaporkan Installation yang direktorinya hilang", async () => {
    const server = createTestServer();
    await installTo(server, ["claude-code/global"]);
    ok(
      await server.fs.remove(path.join(storePath("claude-code"), "brainstorming"), {
        recursive: true,
      }),
    );

    const report = await doctor(server);

    expect(report.missing.map((entry) => entry.skillName)).toEqual(["brainstorming"]);
    expect(report.unmanaged).toEqual([]);
  });

  it("melaporkan direktori Store yang tidak dikelola", async () => {
    const server = createTestServer();
    await installTo(server, ["claude-code/global"]);
    ok(await server.fs.mkdir(path.join(storePath("claude-code"), "asing"), { recursive: true }));

    const report = await doctor(server);

    expect(report.unmanaged.map((entry) => entry.skillName)).toEqual(["asing"]);
    expect(report.missing).toEqual([]);
  });

  it("melaporkan sisa direktori sementara", async () => {
    const server = createTestServer();
    await installTo(server, ["claude-code/global"]);
    const leftover = path.join(storePath("claude-code"), `${TEMP_PREFIX}sisa`);
    ok(await server.fs.mkdir(leftover, { recursive: true }));

    expect((await doctor(server)).tempDirs).toEqual([leftover]);
  });

  it("menolak akses tanpa cookie sesi dengan 401", async () => {
    const response = await createTestServer().request("/api/doctor", { omitCookie: true });

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe("unauthorized");
  });
});

describe("POST /api/doctor/clean-temp", () => {
  it("menghapus sisa temp dan TIDAK menyentuh direktori skill asli", async () => {
    const server = createTestServer();
    await installTo(server, ["claude-code/global"]);
    const store = storePath("claude-code");
    const leftover = path.join(store, `${TEMP_PREFIX}sisa`);
    ok(await server.fs.mkdir(leftover, { recursive: true }));
    ok(await server.fs.write(path.join(leftover, "SKILL.md"), "# sisa\n"));

    const response = await server.request("/api/doctor/clean-temp", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: [leftover] });
    expect(await server.fs.exists(leftover)).toBe(false);
    expect(await server.fs.exists(path.join(store, "brainstorming", "SKILL.md"))).toBe(true);
    expect((await doctor(server)).tempDirs).toEqual([]);
  });

  it("mengembalikan daftar kosong bila tidak ada sisa temp", async () => {
    const server = createTestServer();
    await installTo(server, ["claude-code/global"]);

    const response = await server.request("/api/doctor/clean-temp", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: [] });
  });

  it("menolak akses tanpa cookie sesi dengan 401", async () => {
    const response = await createTestServer().request("/api/doctor/clean-temp", {
      method: "POST",
      omitCookie: true,
    });

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error.code).toBe("unauthorized");
  });
});
