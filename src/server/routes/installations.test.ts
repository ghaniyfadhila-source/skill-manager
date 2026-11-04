import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTestServer,
  HOME,
  jsonRequest,
  ok,
  seedSkill,
  storePath,
  type TestServer,
} from "./fixture.js";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface InstallationRow {
  skillId: string;
  skillName: string;
  targetId: string;
  storeId: string;
  mode: string;
  installedHash: string;
  installedAt: string;
  drift?: string;
}

interface TargetResultView {
  targetId: string;
  ok: boolean;
  installation?: { storeId: string; installedHash: string };
  error?: { code: string; message: string };
}

async function rows(server: TestServer): Promise<InstallationRow[]> {
  const response = await server.request("/api/installations");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { installations: InstallationRow[] };
  return body.installations;
}

async function install(
  server: TestServer,
  targets: readonly string[],
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return jsonRequest(server, "/api/installations", "POST", {
    skill: "brainstorming",
    targets,
    ...extra,
  });
}

async function results(response: Response): Promise<TargetResultView[]> {
  const body = (await response.json()) as { results: TargetResultView[] };
  return body.results;
}

describe("POST /api/installations", () => {
  it("memasang skill ke Target dan mengembalikan hasil per Target", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);

    const response = await install(server, ["claude-code/global"]);

    expect(response.status).toBe(200);
    const body = await results(response);
    expect(body[0]?.targetId).toBe("claude-code/global");
    expect(body[0]?.ok).toBe(true);
    expect(body[0]?.installation?.storeId).toBe("~/.claude/skills");
    expect(
      await server.fs.exists(path.join(storePath("claude-code"), "brainstorming", "SKILL.md")),
    ).toBe(true);
  });

  it("menolak Target shared tanpa acknowledgeShared dengan 409 dan daftar member", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);

    const response = await install(server, ["shared/global"]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("shared_confirmation_required");
    const details = body.error.details as {
      stores: { storeId: string; members: string[] }[];
      targets: string[];
    };
    expect(details.stores).toHaveLength(1);
    expect(details.stores[0]?.storeId).toBe("~/.agents/skills");
    expect(details.stores[0]?.members).toContain("codex");
    expect(details.targets).toEqual(["shared/global"]);
    expect(await server.fs.exists(path.join(storePath("shared"), "brainstorming"))).toBe(false);
  });

  it("memasang ke Target shared setelah acknowledgeShared", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);

    const response = await install(server, ["shared/global"], { acknowledgeShared: true });

    expect(response.status).toBe(200);
    expect((await results(response))[0]?.ok).toBe(true);
    expect(await server.fs.exists(path.join(storePath("shared"), "brainstorming"))).toBe(true);
  });

  it("mengembalikan 404 skill_not_found untuk skill yang tidak ada", async () => {
    const server = createTestServer();

    const response = await install(server, ["claude-code/global"]);

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("skill_not_found");
  });

  it("mengembalikan 400 bad_request beserta issues untuk body yang tidak valid", async () => {
    const server = createTestServer();

    const response = await jsonRequest(server, "/api/installations", "POST", {
      skill: "brainstorming",
      targets: [],
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details).toBeDefined();
  });

  it("menolak body yang bukan JSON dengan 400", async () => {
    const response = await createTestServer().request("/api/installations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bukan-json",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error.code).toBe("bad_request");
  });
});

describe("GET /api/installations", () => {
  it("mengembalikan baris datar per Target beserta status drift", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);
    await install(server, ["claude-code/global", "opencode/global"]);

    const list = await rows(server);

    expect(list.map((row) => row.targetId).sort()).toEqual([
      "claude-code/global",
      "opencode/global",
    ]);
    expect(list[0]?.skillName).toBe("brainstorming");
    expect(list[0]?.mode).toBe("copy");
    expect(list[0]?.drift).toBe("clean");
    expect(list[0]?.installedHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("menandai drift modified bila isi Store berubah", async () => {
    const server = createTestServer();
    await seedSkill(server.fs);
    await install(server, ["claude-code/global"]);
    ok(
      await server.fs.write(
        path.join(storePath("claude-code"), "brainstorming", "SKILL.md"),
        "# diubah user\n",
      ),
    );

    const list = await rows(server);

    expect(list[0]?.drift).toBe("modified");
  });

  it("mengembalikan daftar kosong bila belum ada Installation", async () => {
    expect(await rows(createTestServer())).toEqual([]);
  });
});

describe("DELETE /api/installations", () => {
  async function installed(server: TestServer, targets: readonly string[]): Promise<void> {
    await seedSkill(server.fs);
    const response = await install(server, targets, { acknowledgeShared: true });
    expect(response.status).toBe(200);
  }

  function uninstall(
    server: TestServer,
    targets: readonly string[],
    extra: Record<string, unknown> = {},
  ): Promise<Response> {
    return jsonRequest(server, "/api/installations", "DELETE", {
      skill: "brainstorming",
      targets,
      ...extra,
    });
  }

  it("mencabut skill dari Target dan menghapus catatannya", async () => {
    const server = createTestServer();
    await installed(server, ["claude-code/global"]);

    const response = await uninstall(server, ["claude-code/global"]);

    expect(response.status).toBe(200);
    expect((await results(response))[0]?.ok).toBe(true);
    expect(await server.fs.exists(path.join(storePath("claude-code"), "brainstorming"))).toBe(
      false,
    );
    expect(await rows(server)).toEqual([]);
  });

  it("menolak pencabutan Target shared tanpa acknowledgeShared dengan 409", async () => {
    const server = createTestServer();
    await installed(server, ["shared/global"]);

    const response = await uninstall(server, ["shared/global"]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("shared_confirmation_required");
    const details = body.error.details as {
      stores: { storeId: string; members: string[] }[];
      targets: string[];
    };
    expect(details.stores[0]?.storeId).toBe("~/.agents/skills");
    expect(details.targets).toEqual(["shared/global"]);
    expect(await server.fs.exists(path.join(storePath("shared"), "brainstorming"))).toBe(true);
  });

  it("menolak pencabutan saat drift dengan 409 dan kedua hash", async () => {
    const server = createTestServer();
    await installed(server, ["claude-code/global"]);
    const modified = path.join(storePath("claude-code"), "brainstorming", "SKILL.md");
    ok(await server.fs.write(modified, "# diubah user\n"));

    const response = await uninstall(server, ["claude-code/global"]);

    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("drift_detected");
    const details = body.error.details as {
      storeId: string;
      path: string;
      expectedHash: string;
      actualHash: string;
    };
    expect(details.storeId).toBe("~/.claude/skills");
    expect(details.path).toBe(path.join(storePath("claude-code"), "brainstorming"));
    expect(details.expectedHash).toMatch(/^sha256:/);
    expect(details.actualHash).toMatch(/^sha256:/);
    expect(details.expectedHash).not.toBe(details.actualHash);
    expect(await server.fs.exists(path.join(storePath("claude-code"), "brainstorming"))).toBe(true);
  });

  it("mencabut meski drift bila force diberikan", async () => {
    const server = createTestServer();
    await installed(server, ["claude-code/global"]);
    ok(
      await server.fs.write(
        path.join(storePath("claude-code"), "brainstorming", "SKILL.md"),
        "# diubah user\n",
      ),
    );

    const response = await uninstall(server, ["claude-code/global"], { force: true });

    expect(response.status).toBe(200);
    expect((await results(response))[0]?.ok).toBe(true);
    expect(await server.fs.exists(path.join(storePath("claude-code"), "brainstorming"))).toBe(
      false,
    );
  });

  it("mencabut dari Target shared setelah acknowledgeShared", async () => {
    const server = createTestServer();
    await installed(server, ["shared/global"]);

    const response = await uninstall(server, ["shared/global"], { acknowledgeShared: true });

    expect(response.status).toBe(200);
    expect(await server.fs.exists(path.join(storePath("shared"), "brainstorming"))).toBe(false);
  });

  it("mengembalikan 404 skill_not_found untuk skill yang tidak ada", async () => {
    const response = await uninstall(createTestServer(), ["claude-code/global"]);

    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe("skill_not_found");
  });
});
